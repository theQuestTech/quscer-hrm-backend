import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceSource, AttendanceStatus, CorrectionStatus, EmployeeStatus, Prisma } from '@prisma/client';
import { startOfDayUtc, todayInTimeZone, zonedTime } from '../common/dates';
import { computeShiftMetrics } from './shift-metrics';
import { approverScope, assertInScope } from '../common/approver-scope';
import { findEmployeeForUser, requireEmployeeForUser } from '../common/current-employee';
import { hasPermission } from '../rbac/rbac.service';

// A "day" is stored as midnight UTC of the calendar date, but WHICH calendar
// date "now" is follows the employee's Branch timezone (falling back to the
// org default) — so a 02:00 check-in in Karachi counts for that Karachi day,
// not the previous UTC day.
//
// Late / early-exit / overtime minutes (WBS 3.4) are worked out against the
// employee's assigned shift whenever check-in or check-out times change.

type ShiftedEmployee = {
  id: string;
  branch: { timezone: string } | null;
  shift: { startTime: string; endTime: string } | null;
};

const HOURS_TO_CLOSE_OVERNIGHT = 20;

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  private async todayFor(organizationId: string, branchTimezone?: string | null) {
    if (branchTimezone) return todayInTimeZone(branchTimezone);
    const settings = await this.prisma.organizationLocaleSettings.findUnique({
      where: { organizationId },
    });
    return todayInTimeZone(settings?.defaultTimezone);
  }

  async checkIn(organizationId: string, userId: string) {
    const employee = await requireEmployeeForUser(this.prisma, organizationId, userId);
    const today = await this.todayFor(organizationId, employee.branch?.timezone);

    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });
    if (existing?.checkIn) {
      throw new BadRequestException('Already checked in today');
    }

    const now = new Date();
    const timing = await this.timing(organizationId, employee, today, now, null);
    return this.prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      create: {
        organizationId,
        employeeId: employee.id,
        date: today,
        checkIn: now,
        source: AttendanceSource.APP_CHECKIN,
        ...timing,
      },
      update: { checkIn: now, source: AttendanceSource.APP_CHECKIN, ...timing },
    });
  }

  // Status plus the minute counts for a record with these times.
  private async timing(
    organizationId: string,
    employee: ShiftedEmployee,
    day: Date,
    checkIn: Date | null,
    checkOut: Date | null,
  ) {
    const settings = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    const metrics = computeShiftMetrics({
      day,
      shift: employee.shift,
      timeZone: employee.branch?.timezone ?? settings?.defaultTimezone,
      checkIn,
      checkOut,
      graceMinutes: settings?.lateGraceMinutes ?? 15,
    });
    const { isLate, ...minutes } = metrics;
    return { ...minutes, status: isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT };
  }

  async checkOut(organizationId: string, userId: string) {
    const employee = await requireEmployeeForUser(this.prisma, organizationId, userId);
    const today = await this.todayFor(organizationId, employee.branch?.timezone);

    const now = new Date();
    let existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });
    if (!existing?.checkIn) {
      // Night shift: checked in yesterday evening, checking out after
      // midnight — close yesterday's record if it is still open.
      const open = await this.prisma.attendanceRecord.findFirst({
        where: { employeeId: employee.id, checkIn: { not: null }, checkOut: null, date: { lt: today } },
        orderBy: { date: 'desc' },
      });
      if (open?.checkIn && now.getTime() - open.checkIn.getTime() < HOURS_TO_CLOSE_OVERNIGHT * 3600_000) {
        existing = open;
      }
    }
    if (!existing?.checkIn) {
      throw new BadRequestException('Cannot check out before checking in');
    }
    if (existing.checkOut) {
      throw new BadRequestException('Already checked out today');
    }

    const timing = await this.timing(organizationId, employee, existing.date, existing.checkIn, now);
    return this.prisma.attendanceRecord.update({
      where: { id: existing.id },
      // Keep a manager's status (e.g. HALF_DAY) — only a PRESENT/LATE
      // status is re-derived from the times.
      data: { checkOut: now, ...this.keepManualStatus(existing.status, timing) },
    });
  }

  private keepManualStatus<T extends { status: AttendanceStatus }>(current: AttendanceStatus, timing: T) {
    if (current === AttendanceStatus.PRESENT || current === AttendanceStatus.LATE) return timing;
    const { status: _derived, ...rest } = timing;
    return rest;
  }

  // The caller's record for today (null if they haven't checked in) — drives
  // the check-in / check-out button state.
  async today(organizationId: string, userId: string) {
    const employee = await findEmployeeForUser(this.prisma, organizationId, userId);
    if (!employee) return { employeeLinked: false, date: null, record: null };
    const today = await this.todayFor(organizationId, employee.branch?.timezone);
    let record = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });
    if (!record) {
      // Still on a night shift that started yesterday — show that record so
      // the button offers "check out" rather than a new check-in.
      const open = await this.prisma.attendanceRecord.findFirst({
        where: { employeeId: employee.id, checkIn: { not: null }, checkOut: null, date: { lt: today } },
        orderBy: { date: 'desc' },
      });
      if (open?.checkIn && Date.now() - open.checkIn.getTime() < HOURS_TO_CLOSE_OVERNIGHT * 3600_000) {
        record = open;
      }
    }
    return { employeeLinked: true, date: record?.date ?? today, record };
  }

  // Admin/manager path — mark attendance for someone else (e.g. from a
  // manual register). Status is taken as given, not derived; to fix times,
  // use a correction instead. Every manual mark is audited so a
  // correction always shows who made it.
  async markManual(
    organizationId: string,
    user: { id: string; permissions?: string[] },
    employeeId: string,
    date: string,
    status: AttendanceStatus,
    notes?: string,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    assertInScope(await approverScope(this.prisma, organizationId, user), employeeId);
    const actorUserId = user.id;

    const day = startOfDayUtc(new Date(date));
    const record = await this.prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date: day } },
      create: {
        organizationId, employeeId, date: day, status,
        source: AttendanceSource.MANUAL, notes,
      },
      update: { status, notes, source: AttendanceSource.MANUAL },
    });
    await this.prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId,
        eventType: 'attendance.marked',
        entityType: 'AttendanceRecord',
        entityId: record.id,
        metadata: { employeeId, date: day, status },
      },
    });
    return record;
  }

  // One row per active employee for a given day, with their record if any —
  // the attendance register (WBS 5.10 backing data). A manager only sees
  // their team.
  async register(organizationId: string, user: { id: string; permissions?: string[] }, date?: string) {
    const day = date ? startOfDayUtc(new Date(date)) : await this.todayFor(organizationId);
    const scope = await approverScope(this.prisma, organizationId, user);
    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId,
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE] },
        ...(scope && { id: { in: scope } }),
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true, employeeNumber: true, firstName: true, lastName: true, designation: true,
        attendanceRecords: { where: { date: day } },
      },
    });
    return {
      date: day,
      rows: employees.map(({ attendanceRecords, ...e }) => ({
        employee: e,
        record: attendanceRecords[0] ?? null,
      })),
    };
  }

  // Someone else's history needs hrm.attendance.approve; without it the
  // caller only ever gets their own.
  async history(
    organizationId: string,
    user: { id: string; permissions?: string[] },
    employeeId?: string,
    from?: string,
    to?: string,
  ) {
    const own = await findEmployeeForUser(this.prisma, organizationId, user.id);
    const targetId = employeeId ?? own?.id;
    if (!targetId) {
      throw new BadRequestException('No employee record is linked to this user account');
    }
    if (targetId !== own?.id) {
      if (!hasPermission(user, 'hrm.attendance.approve')) {
        throw new ForbiddenException('You can only view your own attendance');
      }
      assertInScope(await approverScope(this.prisma, organizationId, user), targetId);
    }

    return this.prisma.attendanceRecord.findMany({
      where: {
        organizationId,
        employeeId: targetId,
        ...(from || to
          ? {
              date: {
                ...(from && { gte: startOfDayUtc(new Date(from)) }),
                ...(to && { lte: startOfDayUtc(new Date(to)) }),
              },
            }
          : {}),
      },
      orderBy: { date: 'desc' },
    });
  }

  // --- Corrections (WBS 3.3) -------------------------------------------
  // An employee who forgot to check in/out asks for the times to be fixed;
  // someone with hrm.attendance.approve (not the same person) approves, and
  // the record is updated and audited. Times are "HH:mm" in the employee's
  // branch timezone; a check-out earlier than the check-in is the next day.

  async requestCorrection(
    organizationId: string,
    userId: string,
    dto: { date: string; checkInTime?: string; checkOutTime?: string; reason: string },
  ) {
    const employee = await requireEmployeeForUser(this.prisma, organizationId, userId);
    if (!dto.checkInTime && !dto.checkOutTime) {
      throw new BadRequestException('Give a check-in time, a check-out time, or both');
    }
    const day = startOfDayUtc(new Date(dto.date));
    const today = await this.todayFor(organizationId, employee.branch?.timezone);
    if (day > today) throw new BadRequestException('You can only correct today or earlier');

    const settings = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    const timeZone = employee.branch?.timezone ?? settings?.defaultTimezone;
    const checkIn = dto.checkInTime ? zonedTime(day, dto.checkInTime, timeZone) : null;
    let checkOut = dto.checkOutTime ? zonedTime(day, dto.checkOutTime, timeZone) : null;
    if (checkOut) {
      const existing = await this.prisma.attendanceRecord.findUnique({
        where: { employeeId_date: { employeeId: employee.id, date: day } },
      });
      const effectiveIn = checkIn ?? existing?.checkIn ?? null;
      if (effectiveIn && checkOut <= effectiveIn) {
        checkOut = new Date(checkOut.getTime() + 24 * 3600_000);
      }
    }

    const pending = await this.prisma.attendanceCorrection.count({
      where: { employeeId: employee.id, date: day, status: CorrectionStatus.PENDING },
    });
    if (pending > 0) throw new BadRequestException('You already have a correction waiting for this day');

    return this.prisma.attendanceCorrection.create({
      data: {
        organizationId,
        employeeId: employee.id,
        date: day,
        checkIn,
        checkOut,
        reason: dto.reason,
        requestedByUserId: userId,
      },
    });
  }

  async listCorrections(organizationId: string, user: { id: string; permissions?: string[] }, status?: string) {
    const where: Prisma.AttendanceCorrectionWhereInput = {
      organizationId,
      ...(status && { status: status as CorrectionStatus }),
    };
    const own = await findEmployeeForUser(this.prisma, organizationId, user.id);
    if (!hasPermission(user, 'hrm.attendance.approve')) {
      if (!own) return [];
      where.employeeId = own.id;
    } else {
      // A manager sees their team's and their own.
      const scope = await approverScope(this.prisma, organizationId, user);
      if (scope) where.employeeId = { in: own ? [...scope, own.id] : scope };
    }
    return this.prisma.attendanceCorrection.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } },
    });
  }

  async decideCorrection(
    organizationId: string,
    user: { id: string; permissions?: string[] },
    id: string,
    approve: boolean,
  ) {
    const actorUserId = user.id;
    const correction = await this.prisma.attendanceCorrection.findFirst({
      where: { id, organizationId },
      include: { employee: { include: { branch: true, shift: true } } },
    });
    if (!correction) throw new NotFoundException('Correction not found');
    if (correction.status !== CorrectionStatus.PENDING) {
      throw new BadRequestException('This correction has already been decided');
    }
    if (correction.employee.userId === actorUserId || correction.requestedByUserId === actorUserId) {
      throw new ForbiddenException('You cannot decide your own correction');
    }
    assertInScope(await approverScope(this.prisma, organizationId, user), correction.employeeId);

    return this.prisma.$transaction(async (tx) => {
      const decided = await tx.attendanceCorrection.update({
        where: { id },
        data: {
          status: approve ? CorrectionStatus.APPROVED : CorrectionStatus.REJECTED,
          decidedByUserId: actorUserId,
          decidedAt: new Date(),
        },
      });
      let recordId: string | null = null;
      if (approve) {
        const key = { employeeId_date: { employeeId: correction.employeeId, date: correction.date } };
        const existing = await tx.attendanceRecord.findUnique({ where: key });
        const checkIn = correction.checkIn ?? existing?.checkIn ?? null;
        const checkOut = correction.checkOut ?? existing?.checkOut ?? null;
        const timing = await this.timing(organizationId, correction.employee, correction.date, checkIn, checkOut);
        // A correction proves when they were in, so it replaces ABSENT too;
        // only a manager's HALF_DAY / ON_LEAVE is kept.
        const status =
          existing && (existing.status === AttendanceStatus.HALF_DAY || existing.status === AttendanceStatus.ON_LEAVE)
            ? this.keepManualStatus(existing.status, timing)
            : timing;
        const record = await tx.attendanceRecord.upsert({
          where: key,
          create: {
            organizationId,
            employeeId: correction.employeeId,
            date: correction.date,
            checkIn,
            checkOut,
            source: AttendanceSource.MANUAL,
            notes: `Correction: ${correction.reason}`,
            ...timing,
          },
          update: { checkIn, checkOut, source: AttendanceSource.MANUAL, ...status },
        });
        recordId = record.id;
      }
      await tx.auditEvent.create({
        data: {
          organizationId,
          actorUserId,
          eventType: approve ? 'attendance.correction_approved' : 'attendance.correction_rejected',
          entityType: 'AttendanceCorrection',
          entityId: id,
          metadata: {
            employeeId: correction.employeeId,
            date: correction.date,
            checkIn: correction.checkIn,
            checkOut: correction.checkOut,
            recordId,
          },
        },
      });
      return decided;
    });
  }
}
