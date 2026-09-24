import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceSource, AttendanceStatus, EmployeeStatus } from '@prisma/client';
import { startOfDayUtc, todayInTimeZone } from '../common/dates';
import { findEmployeeForUser, requireEmployeeForUser } from '../common/current-employee';
import { hasPermission } from '../rbac/rbac.service';

// A "day" is stored as midnight UTC of the calendar date, but WHICH calendar
// date "now" is follows the employee's Branch timezone (falling back to the
// org default) — so a 02:00 check-in in Karachi counts for that Karachi day,
// not the previous UTC day.

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

    return this.prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      create: {
        organizationId,
        employeeId: employee.id,
        date: today,
        checkIn: new Date(),
        status: AttendanceStatus.PRESENT,
        source: AttendanceSource.APP_CHECKIN,
      },
      update: { checkIn: new Date(), source: AttendanceSource.APP_CHECKIN },
    });
  }

  async checkOut(organizationId: string, userId: string) {
    const employee = await requireEmployeeForUser(this.prisma, organizationId, userId);
    const today = await this.todayFor(organizationId, employee.branch?.timezone);

    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });
    if (!existing?.checkIn) {
      throw new BadRequestException('Cannot check out before checking in');
    }
    if (existing.checkOut) {
      throw new BadRequestException('Already checked out today');
    }

    return this.prisma.attendanceRecord.update({
      where: { id: existing.id },
      data: { checkOut: new Date() },
    });
  }

  // The caller's record for today (null if they haven't checked in) — drives
  // the check-in / check-out button state.
  async today(organizationId: string, userId: string) {
    const employee = await findEmployeeForUser(this.prisma, organizationId, userId);
    if (!employee) return { employeeLinked: false, date: null, record: null };
    const today = await this.todayFor(organizationId, employee.branch?.timezone);
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });
    return { employeeLinked: true, date: today, record };
  }

  // Admin/manager path — mark attendance for someone else (e.g. from a
  // manual register). No overtime/late calculation yet (WBS 3.4) — status
  // is taken as given, not derived. Every manual mark is audited so a
  // correction always shows who made it.
  async markManual(
    organizationId: string,
    actorUserId: string,
    employeeId: string,
    date: string,
    status: AttendanceStatus,
    notes?: string,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

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
  // the manager's attendance register (WBS 5.10 backing data).
  async register(organizationId: string, date?: string) {
    const day = date ? startOfDayUtc(new Date(date)) : await this.todayFor(organizationId);
    const employees = await this.prisma.employee.findMany({
      where: { organizationId, status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE] } },
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
    if (targetId !== own?.id && !hasPermission(user, 'hrm.attendance.approve')) {
      throw new ForbiddenException('You can only view your own attendance');
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
}
