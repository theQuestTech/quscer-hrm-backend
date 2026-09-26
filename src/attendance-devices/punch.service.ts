// Turns punches from attendance machines into attendance records.
//   ingest()   — saves punches (duplicates ignored), matches machine IDs to
//                employees and recomputes the affected days.
//   relink()   — after a machine ID is set on an employee, picks up that
//                ID's earlier punches.
// A day's times are the first and last punch (together with any app
// check-in that day); late/early/overtime come from the employee's shift.

import { Injectable, Logger } from '@nestjs/common';
import { AttendanceSource, AttendanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeShiftMetrics } from '../attendance/shift-metrics';
import { dayKey } from '../common/dates';
import { dayTimes, normalizeMachineId, workDateFor } from './punch-rules';

export interface IncomingPunch {
  machineUserId: string;
  punchedAt: Date;
  kind?: 'IN' | 'OUT' | null;
}

const MAX_AHEAD_MS = 24 * 60 * 60 * 1000; // a machine clock a day ahead is wrong, not early

type EmployeeForDay = {
  id: string;
  machineUserId: string | null;
  branch: { timezone: string } | null;
  shift: { startTime: string; endTime: string } | null;
};

@Injectable()
export class PunchService {
  private readonly log = new Logger('Punches');

  constructor(private prisma: PrismaService) {}

  private async orgSettings(organizationId: string) {
    const s = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    return { timeZone: s?.defaultTimezone ?? 'Asia/Karachi', graceMinutes: s?.lateGraceMinutes ?? 15 };
  }

  async ingest(organizationId: string, deviceId: string | null, incoming: IncomingPunch[]) {
    const now = Date.now();
    const valid = incoming
      .map((p) => ({ ...p, machineUserId: normalizeMachineId(p.machineUserId) }))
      .filter((p) => p.machineUserId && !Number.isNaN(p.punchedAt.getTime()) && p.punchedAt.getTime() <= now + MAX_AHEAD_MS);
    const skipped = incoming.length - valid.length;
    if (!valid.length) {
      if (deviceId) await this.touchDevice(deviceId, false);
      return { received: incoming.length, saved: 0, matched: 0, skipped, unknownIds: [] as string[] };
    }

    const ids = [...new Set(valid.map((p) => p.machineUserId))];
    const employees = await this.prisma.employee.findMany({
      where: { organizationId, machineUserId: { in: ids } },
      select: { id: true, machineUserId: true, branch: { select: { timezone: true } }, shift: { select: { startTime: true, endTime: true } } },
    });
    const byMachineId = new Map(employees.map((e) => [e.machineUserId!, e]));
    const { timeZone } = await this.orgSettings(organizationId);

    const rows = valid.map((p) => {
      const e = byMachineId.get(p.machineUserId);
      return {
        organizationId,
        deviceId,
        machineUserId: p.machineUserId,
        employeeId: e?.id ?? null,
        punchedAt: p.punchedAt,
        workDate: e ? workDateFor(p.punchedAt, e.branch?.timezone ?? timeZone, e.shift) : null,
        kind: p.kind ?? null,
      };
    });
    const { count } = await this.prisma.attendancePunch.createMany({ data: rows, skipDuplicates: true });

    const days = new Map<string, { employee: EmployeeForDay; workDate: Date }>();
    for (const r of rows) {
      if (!r.employeeId || !r.workDate) continue;
      days.set(`${r.employeeId}|${dayKey(r.workDate)}`, { employee: byMachineId.get(r.machineUserId)!, workDate: r.workDate });
    }
    for (const { employee, workDate } of days.values()) await this.recomputeDay(organizationId, employee, workDate);

    if (deviceId) await this.touchDevice(deviceId, true);
    const unknownIds = ids.filter((id) => !byMachineId.has(id));
    return { received: incoming.length, saved: count, matched: rows.filter((r) => r.employeeId).length, skipped, unknownIds };
  }

  private touchDevice(deviceId: string, punched: boolean) {
    const now = new Date();
    return this.prisma.attendanceDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: now, ...(punched && { lastPunchAt: now }) },
    });
  }

  // The employee's punches (plus any app check-in) for one day → the record.
  async recomputeDay(organizationId: string, employee: EmployeeForDay, workDate: Date) {
    const punches = await this.prisma.attendancePunch.findMany({
      where: { organizationId, employeeId: employee.id, workDate },
      select: { punchedAt: true },
    });
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: workDate } },
    });
    if (!punches.length) return existing;
    const times = punches.map((p) => p.punchedAt);
    if (existing?.checkIn) times.push(existing.checkIn);
    if (existing?.checkOut) times.push(existing.checkOut);
    const { checkIn, checkOut } = dayTimes(times);
    const { timeZone, graceMinutes } = await this.orgSettings(organizationId);
    const { isLate, ...minutes } = computeShiftMetrics({
      day: workDate,
      shift: employee.shift,
      timeZone: employee.branch?.timezone ?? timeZone,
      checkIn,
      checkOut,
      graceMinutes,
    });
    const derived = isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
    // HR's half-day or leave stays; anything else follows the punches.
    const keep = existing && (existing.status === AttendanceStatus.HALF_DAY || existing.status === AttendanceStatus.ON_LEAVE);
    const data = { checkIn, checkOut, ...minutes, source: AttendanceSource.BIOMETRIC, ...(keep ? {} : { status: derived }) };
    return this.prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: workDate } },
      create: { organizationId, employeeId: employee.id, date: workDate, status: derived, ...data },
      update: data,
    });
  }

  // A machine ID was just given to (or changed on) this employee: attach
  // that ID's unmatched punches and rebuild those days.
  async relink(organizationId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      select: { id: true, machineUserId: true, branch: { select: { timezone: true } }, shift: { select: { startTime: true, endTime: true } } },
    });
    if (!employee?.machineUserId) return { linked: 0 };
    const { timeZone } = await this.orgSettings(organizationId);
    const punches = await this.prisma.attendancePunch.findMany({
      where: { organizationId, machineUserId: employee.machineUserId, employeeId: null },
      select: { id: true, punchedAt: true },
    });
    const days = new Map<string, Date>();
    for (const p of punches) {
      const workDate = workDateFor(p.punchedAt, employee.branch?.timezone ?? timeZone, employee.shift);
      await this.prisma.attendancePunch.update({ where: { id: p.id }, data: { employeeId: employee.id, workDate } });
      days.set(dayKey(workDate), workDate);
    }
    for (const d of days.values()) await this.recomputeDay(organizationId, employee, d);
    if (punches.length) this.log.log(`Linked ${punches.length} punches to employee ${employee.id}`);
    return { linked: punches.length };
  }
}

export type IngestResult = Awaited<ReturnType<PunchService['ingest']>>;
