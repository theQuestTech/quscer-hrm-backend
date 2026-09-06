import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeaveRequestStatus } from '@prisma/client';

// Inclusive day count between two dates — no weekend/holiday exclusion yet.
// A real implementation needs this to read the org's holiday calendar
// (WBS 1.14 / 3.11), which doesn't exist as a queryable model yet.
function daysBetweenInclusive(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
}

@Injectable()
export class LeaveService {
  constructor(private prisma: PrismaService) {}

  async createLeaveType(organizationId: string, dto: any) {
    return this.prisma.leaveType.create({
      data: {
        organizationId,
        name: dto.name,
        isPaid: dto.isPaid ?? true,
        defaultAnnualDays: dto.defaultAnnualDays ?? 0,
      },
    });
  }

  async listLeaveTypes(organizationId: string) {
    return this.prisma.leaveType.findMany({ where: { organizationId } });
  }

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

  // WBS 3.10 — submit a leave request. Does NOT check/reserve balance at
  // submission time on purpose — balance is only deducted on approval
  // (below), so a pending request can't lock days a manager might reject.
  async createRequest(organizationId: string, userId: string, dto: any) {
    const employee = await this.resolveEmployeeForUser(organizationId, userId);
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate');
    }

    const days = daysBetweenInclusive(startDate, endDate);

    return this.prisma.leaveRequest.create({
      data: {
        organizationId,
        employeeId: employee.id,
        leaveTypeId: dto.leaveTypeId,
        startDate,
        endDate,
        days,
        reason: dto.reason,
        status: LeaveRequestStatus.PENDING,
      },
    });
  }

  async listRequests(organizationId: string, employeeId?: string, status?: string) {
    return this.prisma.leaveRequest.findMany({
      where: {
        organizationId,
        ...(employeeId && { employeeId }),
        ...(status && { status: status as LeaveRequestStatus }),
      },
      orderBy: { createdAt: 'desc' },
      include: { leaveType: true },
    });
  }

  // WBS 3.10 — approval. Deducts from LeaveBalance here, creating a
  // zero-allocation balance row on the fly if one doesn't exist yet rather
  // than failing — a missing balance shouldn't silently block approval,
  // but it WILL show as a negative usedDays-over-allocatedDays, which is
  // the intended visible signal that allocation setup was skipped.
  async decide(
    organizationId: string,
    approverUserId: string,
    requestId: string,
    approve: boolean,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, organizationId },
    });
    if (!request) throw new NotFoundException('Leave request not found');
    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('This request has already been decided');
    }

    const approver = await this.resolveEmployeeForUser(organizationId, approverUserId);

    const updated = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: approve ? LeaveRequestStatus.APPROVED : LeaveRequestStatus.REJECTED,
        approverId: approver.id,
        decidedAt: new Date(),
      },
    });

    if (approve) {
      const year = request.startDate.getUTCFullYear();
      await this.prisma.leaveBalance.upsert({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year,
          },
        },
        create: {
          employeeId: request.employeeId,
          leaveTypeId: request.leaveTypeId,
          year,
          allocatedDays: 0,
          usedDays: request.days,
        },
        update: { usedDays: { increment: request.days } },
      });
    }

    return updated;
  }
}
