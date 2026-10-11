// Field tracking add-on: where field staff are during working hours.
//
// - Only when Quscer support has switched the add-on on for the company
//   (Organization.fieldTrackingSince), and only for employees HR marked as
//   field staff.
// - Only while checked in: positions from before check-in or after check-out
//   are thrown away, never stored.
// - Managers see their own team; HR sees everyone; each person can see their
//   own route.

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { approverScope, assertInScope } from '../common/approver-scope';
import { findEmployeeForUser, requireEmployeeForUser } from '../common/current-employee';
import { todayInTimeZone } from '../common/dates';
import { hasPermission } from '../rbac/rbac.service';
import { acceptPoints, liveStatus, routeSummary } from './tracking-rules';
import { EndVisitDto, PointsDto, StartVisitDto, TrackingEventDto, TrackingSettingsDto } from './dto';

type Caller = { id: string; permissions?: string[] };

// A check-in older than this without a check-out is treated as forgotten.
const OPEN_SHIFT_HOURS = 20;
const NOT_ON = 'Field tracking is not switched on for your company';

@Injectable()
export class TrackingService {
  constructor(private prisma: PrismaService) {}

  async enabled(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { fieldTrackingSince: true } });
    return !!org?.fieldTrackingSince;
  }

  private async requireEnabled(organizationId: string) {
    if (!(await this.enabled(organizationId))) throw new ForbiddenException(NOT_ON);
  }

  private async settings(organizationId: string) {
    const s = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    return { intervalMinutes: s?.trackingIntervalMinutes ?? 5, keepDays: s?.trackingKeepDays ?? 90, timezone: s?.defaultTimezone ?? 'Asia/Karachi' };
  }

  // The check-in that's still open, if any.
  private openShift(employeeId: string, now: Date) {
    return this.prisma.attendanceRecord.findFirst({
      where: { employeeId, checkIn: { not: null, gte: new Date(now.getTime() - OPEN_SHIFT_HOURS * 3600_000) }, checkOut: null },
      orderBy: { checkIn: 'desc' },
    });
  }

  // --- The phone ---------------------------------------------------------------

  // What the phone should do right now: track or not, and how often.
  async me(organizationId: string, userId: string, now = new Date()) {
    const on = await this.enabled(organizationId);
    const employee = await findEmployeeForUser(this.prisma, organizationId, userId);
    const { intervalMinutes } = await this.settings(organizationId);
    const shift = on && employee?.fieldStaff ? await this.openShift(employee.id, now) : null;
    return {
      enabled: on,
      fieldStaff: !!employee?.fieldStaff,
      tracking: !!shift, // share position now
      checkedInAt: shift?.checkIn ?? null,
      intervalMinutes,
    };
  }

  private async fieldEmployee(organizationId: string, userId: string) {
    await this.requireEnabled(organizationId);
    const employee = await requireEmployeeForUser(this.prisma, organizationId, userId);
    if (!employee.fieldStaff) throw new ForbiddenException("You're not set up as field staff — ask HR");
    return employee;
  }

  async addPoints(organizationId: string, userId: string, dto: PointsDto, now = new Date()) {
    const employee = await this.fieldEmployee(organizationId, userId);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { employeeId: employee.id, checkIn: { not: null, gte: new Date(now.getTime() - 50 * 3600_000) } },
      select: { checkIn: true, checkOut: true },
    });
    const windows = records.map((r) => ({ checkIn: r.checkIn!, checkOut: r.checkOut }));
    const { kept, ignored } = acceptPoints(
      dto.points.map((p) => ({ ...p, at: new Date(p.at) })),
      windows,
      now,
    );
    const saved = kept.length
      ? (
          await this.prisma.locationPing.createMany({
            data: kept.map((p) => ({
              organizationId,
              employeeId: employee.id,
              at: p.at,
              latitude: p.latitude,
              longitude: p.longitude,
              accuracy: p.accuracy ?? null,
              battery: p.battery ?? null,
            })),
            skipDuplicates: true,
          })
        ).count
      : 0;
    const shift = await this.openShift(employee.id, now);
    return { saved, ignored: ignored + (kept.length - saved), tracking: !!shift };
  }

  async addEvent(organizationId: string, userId: string, dto: TrackingEventDto, now = new Date()) {
    const employee = await this.fieldEmployee(organizationId, userId);
    const at = dto.at ? new Date(dto.at) : now;
    if (at.getTime() > now.getTime() + 2 * 60_000) throw new BadRequestException('That time is in the future');
    await this.prisma.trackingEvent.create({ data: { organizationId, employeeId: employee.id, at, kind: dto.kind } });
    return { ok: true };
  }

  // "I'm at a client": only while checked in; ends any visit still open.
  async startVisit(organizationId: string, userId: string, dto: StartVisitDto, now = new Date()) {
    const employee = await this.fieldEmployee(organizationId, userId);
    if (!(await this.openShift(employee.id, now))) throw new BadRequestException('Check in first');
    await this.prisma.fieldVisit.updateMany({ where: { employeeId: employee.id, leftAt: null }, data: { leftAt: now } });
    return this.prisma.fieldVisit.create({
      data: {
        organizationId,
        employeeId: employee.id,
        arrivedAt: now,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy ?? null,
        place: dto.place,
        notes: dto.notes || null,
      },
    });
  }

  async endVisit(organizationId: string, userId: string, id: string, dto: EndVisitDto, now = new Date()) {
    const employee = await this.fieldEmployee(organizationId, userId);
    const visit = await this.prisma.fieldVisit.findFirst({ where: { id, employeeId: employee.id } });
    if (!visit) throw new NotFoundException('Visit not found');
    if (visit.leftAt) throw new BadRequestException('This visit has already ended');
    return this.prisma.fieldVisit.update({
      where: { id },
      data: { leftAt: now, ...(dto.notes ? { notes: [visit.notes, dto.notes].filter(Boolean).join('\n') } : {}) },
    });
  }

  // --- Managers and HR ---------------------------------------------------------

  // Everyone in the caller's team who is field staff: where they are now.
  async live(organizationId: string, caller: Caller, now = new Date()) {
    await this.requireEnabled(organizationId);
    const scope = await approverScope(this.prisma, organizationId, caller);
    const { intervalMinutes } = await this.settings(organizationId);
    const people = await this.prisma.employee.findMany({
      where: {
        organizationId,
        fieldStaff: true,
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE] },
        ...(scope ? { id: { in: scope } } : {}),
      },
      select: { id: true, firstName: true, lastName: true, designation: true, employeeNumber: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const since = new Date(now.getTime() - OPEN_SHIFT_HOURS * 3600_000);

    return Promise.all(
      people.map(async (e) => {
        const [shift, last, event, visit] = await Promise.all([
          this.openShift(e.id, now),
          this.prisma.locationPing.findFirst({ where: { employeeId: e.id, at: { gte: since } }, orderBy: { at: 'desc' } }),
          this.prisma.trackingEvent.findFirst({ where: { employeeId: e.id, at: { gte: since } }, orderBy: { at: 'desc' } }),
          this.prisma.fieldVisit.findFirst({ where: { employeeId: e.id, leftAt: null, arrivedAt: { gte: since } }, orderBy: { arrivedAt: 'desc' } }),
        ]);
        const state = liveStatus({
          checkedInAt: shift?.checkIn ?? null,
          lastPointAt: last?.at ?? null,
          lastEvent: event ? { at: event.at, kind: event.kind } : null,
          intervalMinutes,
          now,
        });
        return {
          employee: e,
          status: state.status,
          since: state.since,
          checkedInAt: shift?.checkIn ?? null,
          last: last && { at: last.at, latitude: last.latitude, longitude: last.longitude, accuracy: last.accuracy, battery: last.battery },
          visit: shift && visit ? { id: visit.id, place: visit.place, arrivedAt: visit.arrivedAt } : null,
        };
      }),
    );
  }

  // One person's day: the route, stops, visits and when location was off.
  // Without employeeId: the caller's own day.
  async route(organizationId: string, caller: Caller, employeeId: string | undefined, date: string | undefined, now = new Date()) {
    await this.requireEnabled(organizationId);
    const { timezone } = await this.settings(organizationId);
    let employee;
    if (!employeeId) {
      employee = await requireEmployeeForUser(this.prisma, organizationId, caller.id);
    } else {
      employee = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId }, include: { branch: true } });
      if (!employee) throw new NotFoundException('Employee not found');
      const own = await findEmployeeForUser(this.prisma, organizationId, caller.id);
      if (own?.id !== employee.id) {
        if (!hasPermission(caller, 'hrm.attendance.approve')) throw new ForbiddenException("You can only see your own route");
        assertInScope(await approverScope(this.prisma, organizationId, caller), employee.id);
      }
    }

    const day = date ? new Date(`${date}T00:00:00Z`) : todayInTimeZone(employee.branch?.timezone ?? timezone);
    if (Number.isNaN(day.getTime())) throw new BadRequestException('Not a valid date');
    const record = await this.prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: day } } });
    const who = { id: employee.id, firstName: employee.firstName, lastName: employee.lastName, fieldStaff: employee.fieldStaff };
    const dayText = day.toISOString().slice(0, 10);
    if (!record?.checkIn) return { employee: who, date: dayText, checkIn: null, checkOut: null, points: [], visits: [], events: [], distanceKm: 0, stops: [] };

    const window = { gte: record.checkIn, lte: record.checkOut ?? now };
    const [points, visits, events] = await Promise.all([
      this.prisma.locationPing.findMany({
        where: { employeeId: employee.id, at: window },
        orderBy: { at: 'asc' },
        select: { at: true, latitude: true, longitude: true, accuracy: true, battery: true },
      }),
      this.prisma.fieldVisit.findMany({ where: { employeeId: employee.id, arrivedAt: window }, orderBy: { arrivedAt: 'asc' } }),
      this.prisma.trackingEvent.findMany({ where: { employeeId: employee.id, at: window }, orderBy: { at: 'asc' }, select: { at: true, kind: true } }),
    ]);
    return {
      employee: who,
      date: dayText,
      checkIn: record.checkIn,
      checkOut: record.checkOut,
      points,
      visits,
      events,
      ...routeSummary(points),
    };
  }

  // --- HR settings ---------------------------------------------------------------

  async getSettings(organizationId: string) {
    const { intervalMinutes, keepDays } = await this.settings(organizationId);
    const fieldStaff = await this.prisma.employee.count({ where: { organizationId, fieldStaff: true, status: { not: EmployeeStatus.TERMINATED } } });
    return { enabled: await this.enabled(organizationId), intervalMinutes, keepDays, fieldStaff };
  }

  async updateSettings(organizationId: string, actorUserId: string, dto: TrackingSettingsDto) {
    await this.requireEnabled(organizationId);
    const data = {
      ...(dto.intervalMinutes !== undefined && { trackingIntervalMinutes: dto.intervalMinutes }),
      ...(dto.keepDays !== undefined && { trackingKeepDays: dto.keepDays }),
    };
    const updated = await this.prisma.organizationLocaleSettings.update({ where: { organizationId }, data }).catch(() => {
      throw new BadRequestException('Finish the company setup first');
    });
    await this.prisma.auditEvent.create({
      data: { organizationId, actorUserId, eventType: 'tracking.settings_updated', entityType: 'Organization', entityId: organizationId, metadata: dto as object },
    });
    return { intervalMinutes: updated.trackingIntervalMinutes, keepDays: updated.trackingKeepDays };
  }

  // Positions and location-off notes older than each company's keep period
  // are deleted. Visits stay: they're part of the work record.
  async deleteOld(now = new Date()) {
    const companies = await this.prisma.organizationLocaleSettings.findMany({ select: { organizationId: true, trackingKeepDays: true } });
    let deleted = 0;
    for (const c of companies) {
      const before = new Date(now.getTime() - c.trackingKeepDays * 86400_000);
      deleted += (await this.prisma.locationPing.deleteMany({ where: { organizationId: c.organizationId, at: { lt: before } } })).count;
      await this.prisma.trackingEvent.deleteMany({ where: { organizationId: c.organizationId, at: { lt: before } } });
    }
    return { deleted };
  }
}
