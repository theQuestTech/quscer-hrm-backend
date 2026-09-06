import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceSource, AttendanceStatus } from '@prisma/client';

// A "day" is treated as midnight UTC of the calendar date. This is a
// simplification — a real multi-timezone deployment needs the day boundary
// to follow the employee's Branch timezone (WBS 1.14), not UTC. Flagged
// rather than silently assumed correct.
function startOfDayUtc(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  // Resolves the logged-in User to their linked Employee record.
  // Employee.userId is optional — not every employee necessarily has login
  // access — so this throws clearly rather than returning null and letting
  // a caller silently check in as "nobody."
  private async resolveEmployeeForUser(organizationId: string, userId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { organizationId, userId },
    });
    if (!employee) {
      throw new BadRequestException(
        'No employee record is linked to this user account',
      );
    }
    return employee;
  }

  async checkIn(organizationId: string, userId: string) {
    const employee = await this.resolveEmployeeForUser(organizationId, userId);
    const today = startOfDayUtc();

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
    const employee = await this.resolveEmployeeForUser(organizationId, userId);
    const today = startOfDayUtc();

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

  // Admin/manager path — mark attendance for someone else (e.g. from a
  // manual register). No overtime/late calculation yet (WBS 3.4) — status
  // is taken as given, not derived.
  async markManual(
    organizationId: string,
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
    return this.prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date: day } },
      create: {
        organizationId, employeeId, date: day, status,
        source: AttendanceSource.MANUAL, notes,
      },
      update: { status, notes, source: AttendanceSource.MANUAL },
    });
  }

  async findHistory(
    organizationId: string,
    employeeId: string,
    from?: string,
    to?: string,
  ) {
    return this.prisma.attendanceRecord.findMany({
      where: {
        organizationId,
        employeeId,
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

  // Used by the controller when no employeeId is passed — resolves the
  // caller's own record so self-service history lookups return the right
  // employee's data, not nothing (userId != employeeId).
  async findHistoryForCaller(
    organizationId: string,
    userId: string,
    from?: string,
    to?: string,
  ) {
    const employee = await this.resolveEmployeeForUser(organizationId, userId);
    return this.findHistory(organizationId, employee.id, from, to);
  }
}
