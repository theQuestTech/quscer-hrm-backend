// HR's side of attendance machines: the device list, secret keys, files
// exported from a machine, the "unknown IDs" list, and the places the app
// check-in button may be used from (office networks and locations).

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceDeviceKind, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { Caller, callerAccess } from '../common/caller-access';
import { wallClockToUtc } from '../common/dates';
import { DeviceDto, LocationDto, NetworkDto, PunchBatchDto, UpdateDeviceDto } from './devices.dto';
import { normalizeMachineId, parseCidr } from './punch-rules';
import { IncomingPunch, PunchService } from './punch.service';

export function hashKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

// An exact moment ("…T09:02:11+05:00" / "…Z") is used as is; a plain local
// time is read in the machine's timezone.
export function toPunches(batch: PunchBatchDto['punches'], timeZone: string): { punches: IncomingPunch[]; bad: number } {
  const punches: IncomingPunch[] = [];
  let bad = 0;
  for (const p of batch) {
    const t = p.time.trim();
    const at = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(t) && t.includes('T') ? new Date(t) : wallClockToUtc(t, timeZone);
    if (!at || Number.isNaN(at.getTime())) {
      bad++;
      continue;
    }
    punches.push({ machineUserId: p.machineUserId, punchedAt: at, kind: p.type ?? null });
  }
  return { punches, bad };
}

@Injectable()
export class DevicesService {
  constructor(
    private prisma: PrismaService,
    private rbac: RbacService,
    private punches: PunchService,
  ) {}

  private async requireHr(caller: Caller) {
    const a = await callerAccess(this.prisma, this.rbac, caller);
    if (!a.isHr) throw new ForbiddenException('Only HR can do this');
    return a;
  }

  private async timeZoneFor(organizationId: string, device?: { timezone: string | null; branchId: string | null } | null) {
    if (device?.timezone) return device.timezone;
    if (device?.branchId) {
      const b = await this.prisma.branch.findUnique({ where: { id: device.branchId } });
      if (b?.timezone) return b.timezone;
    }
    const s = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    return s?.defaultTimezone ?? 'Asia/Karachi';
  }

  // --- Devices ------------------------------------------------------------------

  async list(caller: Caller) {
    await this.requireHr(caller);
    const devices = await this.prisma.attendanceDevice.findMany({
      where: { organizationId: caller.organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, kind: true, serialNumber: true, apiKeyHint: true, branchId: true, timezone: true, isActive: true,
        lastSeenAt: true, lastPunchAt: true, createdAt: true,
      },
    });
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const counts = await this.prisma.attendancePunch.groupBy({
      by: ['deviceId'],
      where: { organizationId: caller.organizationId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    return devices.map((d) => ({ ...d, punchesLast24h: counts.find((c) => c.deviceId === d.id)?._count._all ?? 0 }));
  }

  async create(caller: Caller, dto: DeviceDto) {
    await this.requireHr(caller);
    await this.assertBranch(caller.organizationId, dto.branchId);
    this.assertTimeZone(dto.timezone);
    if (dto.kind === AttendanceDeviceKind.ADMS && !dto.serialNumber) throw new BadRequestException("Enter the machine's serial number");
    const apiKey = dto.kind === AttendanceDeviceKind.API ? `qak_${randomBytes(24).toString('base64url')}` : null;
    try {
      const device = await this.prisma.attendanceDevice.create({
        data: {
          organizationId: caller.organizationId,
          name: dto.name.trim(),
          kind: dto.kind,
          serialNumber: dto.kind === AttendanceDeviceKind.ADMS ? dto.serialNumber!.trim().toUpperCase() : null,
          apiKeyHash: apiKey ? hashKey(apiKey) : null,
          apiKeyHint: apiKey ? apiKey.slice(-4) : null,
          branchId: dto.branchId || null,
          timezone: dto.timezone || null,
        },
      });
      await this.audit(caller, 'attendance.device_added', device.id, { name: device.name, kind: device.kind });
      // The key is shown once; only its hash is kept.
      return { id: device.id, apiKey };
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('A machine with this serial number is already registered');
      throw e;
    }
  }

  async update(caller: Caller, id: string, dto: UpdateDeviceDto) {
    await this.requireHr(caller);
    await this.find(caller.organizationId, id);
    await this.assertBranch(caller.organizationId, dto.branchId);
    this.assertTimeZone(dto.timezone);
    await this.prisma.attendanceDevice.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId || null }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone || null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    return { ok: true };
  }

  async newKey(caller: Caller, id: string) {
    await this.requireHr(caller);
    const device = await this.find(caller.organizationId, id);
    if (device.kind !== AttendanceDeviceKind.API) throw new BadRequestException('Only API connections have a key');
    const apiKey = `qak_${randomBytes(24).toString('base64url')}`;
    await this.prisma.attendanceDevice.update({ where: { id }, data: { apiKeyHash: hashKey(apiKey), apiKeyHint: apiKey.slice(-4) } });
    await this.audit(caller, 'attendance.device_key_replaced', id, {});
    return { apiKey };
  }

  // Punches already received stay; the machine just can't send more.
  async remove(caller: Caller, id: string) {
    await this.requireHr(caller);
    await this.find(caller.organizationId, id);
    await this.prisma.attendanceDevice.delete({ where: { id } });
    return { ok: true };
  }

  private async find(organizationId: string, id: string) {
    const d = await this.prisma.attendanceDevice.findFirst({ where: { id, organizationId } });
    if (!d) throw new NotFoundException('Device not found');
    return d;
  }

  private async assertBranch(organizationId: string, branchId?: string | null) {
    if (branchId && !(await this.prisma.branch.count({ where: { id: branchId, organizationId } }))) {
      throw new BadRequestException('Branch not found');
    }
  }

  private assertTimeZone(tz?: string | null) {
    if (!tz) return;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      throw new BadRequestException(`Unknown timezone "${tz}"`);
    }
  }

  // --- Punches coming in ---------------------------------------------------------

  // Another system sending punches with a device key (X-Device-Key header).
  async ingestWithKey(key: string | undefined, batch: PunchBatchDto) {
    if (!key) throw new ForbiddenException('Send the device key in the X-Device-Key header');
    const device = await this.prisma.attendanceDevice.findUnique({ where: { apiKeyHash: hashKey(key.trim()) } });
    if (!device || !device.isActive) throw new ForbiddenException('Unknown or switched-off device key');
    const { punches, bad } = toPunches(batch.punches, await this.timeZoneFor(device.organizationId, device));
    const result = await this.punches.ingest(device.organizationId, device.id, punches);
    return { ...result, skipped: result.skipped + bad };
  }

  // Rows read from a file HR exported from the machine's software.
  async importFile(caller: Caller, deviceId: string | undefined, batch: PunchBatchDto) {
    await this.requireHr(caller);
    const device = deviceId ? await this.find(caller.organizationId, deviceId) : null;
    const { punches, bad } = toPunches(batch.punches, await this.timeZoneFor(caller.organizationId, device));
    const result = await this.punches.ingest(caller.organizationId, device?.id ?? null, punches);
    await this.audit(caller, 'attendance.punches_imported', device?.id ?? caller.organizationId, {
      rows: batch.punches.length, saved: result.saved, matched: result.matched,
    });
    return { ...result, skipped: result.skipped + bad };
  }

  // A ZKTeco-style machine talking to /iclock. Only machines HR registered
  // are accepted.
  async admsDevice(serialNumber: string | undefined) {
    if (!serialNumber) return null;
    const device = await this.prisma.attendanceDevice.findUnique({ where: { serialNumber: serialNumber.trim().toUpperCase() } });
    if (!device || !device.isActive || device.kind !== AttendanceDeviceKind.ADMS) return null;
    await this.prisma.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return device;
  }

  async ingestAdms(device: { id: string; organizationId: string; timezone: string | null; branchId: string | null }, raw: { machineUserId: string; wallTime: string; kind: 'IN' | 'OUT' | null }[]) {
    const tz = await this.timeZoneFor(device.organizationId, device);
    const punches: IncomingPunch[] = [];
    for (const r of raw) {
      const at = wallClockToUtc(r.wallTime, tz);
      if (at) punches.push({ machineUserId: r.machineUserId, punchedAt: at, kind: r.kind });
    }
    return this.punches.ingest(device.organizationId, device.id, punches);
  }

  // --- Unknown machine IDs -----------------------------------------------------------

  async unmatched(caller: Caller) {
    await this.requireHr(caller);
    const groups = await this.prisma.attendancePunch.groupBy({
      by: ['machineUserId'],
      where: { organizationId: caller.organizationId, employeeId: null },
      _count: { _all: true },
      _min: { punchedAt: true },
      _max: { punchedAt: true },
      orderBy: { _max: { punchedAt: 'desc' } },
      take: 200,
    });
    return groups.map((g) => ({ machineUserId: g.machineUserId, punches: g._count._all, firstAt: g._min.punchedAt, lastAt: g._max.punchedAt }));
  }

  async link(caller: Caller, machineUserId: string, employeeId: string) {
    await this.requireHr(caller);
    const id = normalizeMachineId(machineUserId);
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId: caller.organizationId } });
    if (!employee) throw new NotFoundException('Employee not found');
    const taken = await this.prisma.employee.findFirst({ where: { organizationId: caller.organizationId, machineUserId: id, id: { not: employeeId } } });
    if (taken) throw new ConflictException(`Machine ID ${id} already belongs to ${taken.firstName} ${taken.lastName}`);
    await this.prisma.employee.update({ where: { id: employeeId }, data: { machineUserId: id } });
    await this.audit(caller, 'attendance.machine_id_linked', employeeId, { machineUserId: id });
    return this.punches.relink(caller.organizationId, employeeId);
  }

  async discard(caller: Caller, machineUserId: string) {
    await this.requireHr(caller);
    const { count } = await this.prisma.attendancePunch.deleteMany({
      where: { organizationId: caller.organizationId, machineUserId: normalizeMachineId(machineUserId), employeeId: null },
    });
    return { deleted: count };
  }

  // --- Office networks and locations ----------------------------------------------------

  async listNetworks(caller: Caller) {
    await this.requireHr(caller);
    return this.prisma.officeNetwork.findMany({ where: { organizationId: caller.organizationId }, orderBy: { createdAt: 'asc' } });
  }

  async addNetwork(caller: Caller, dto: NetworkDto) {
    await this.requireHr(caller);
    const parsed = parseCidr(dto.cidr);
    if (!parsed) throw new BadRequestException('Enter an internet address like 39.45.10.20, or a range like 39.45.10.0/24');
    return this.prisma.officeNetwork.create({
      data: { organizationId: caller.organizationId, name: dto.name.trim(), cidr: dto.cidr.trim() },
    });
  }

  async removeNetwork(caller: Caller, id: string) {
    await this.requireHr(caller);
    const { count } = await this.prisma.officeNetwork.deleteMany({ where: { id, organizationId: caller.organizationId } });
    if (!count) throw new NotFoundException('Network not found');
    return { ok: true };
  }

  async listLocations(caller: Caller) {
    await this.requireHr(caller);
    return this.prisma.officeLocation.findMany({ where: { organizationId: caller.organizationId }, orderBy: { createdAt: 'asc' } });
  }

  async addLocation(caller: Caller, dto: LocationDto) {
    await this.requireHr(caller);
    return this.prisma.officeLocation.create({
      data: {
        organizationId: caller.organizationId,
        name: dto.name.trim(),
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeters: dto.radiusMeters ?? 200,
      },
    });
  }

  async updateLocation(caller: Caller, id: string, dto: Partial<LocationDto>) {
    await this.requireHr(caller);
    const loc = await this.prisma.officeLocation.findFirst({ where: { id, organizationId: caller.organizationId } });
    if (!loc) throw new NotFoundException('Location not found');
    return this.prisma.officeLocation.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.latitude !== undefined && { latitude: dto.latitude }),
        ...(dto.longitude !== undefined && { longitude: dto.longitude }),
        ...(dto.radiusMeters !== undefined && { radiusMeters: dto.radiusMeters }),
      },
    });
  }

  async removeLocation(caller: Caller, id: string) {
    await this.requireHr(caller);
    const { count } = await this.prisma.officeLocation.deleteMany({ where: { id, organizationId: caller.organizationId } });
    if (!count) throw new NotFoundException('Location not found');
    return { ok: true };
  }

  private audit(caller: Caller, eventType: string, entityId: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.auditEvent.create({
      data: { organizationId: caller.organizationId, actorUserId: caller.id, eventType, entityType: 'AttendanceDevice', entityId, metadata },
    });
  }
}
