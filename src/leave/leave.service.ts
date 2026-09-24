import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeaveRequestStatus } from '@prisma/client';
import { startOfDayUtc } from '../common/dates';
import { countWorkingDays } from '../common/work-calendar';
import { findEmployeeForUser, requireEmployeeForUser } from '../common/current-employee';
import { hasPermission } from '../rbac/rbac.service';

type CallingUser = { id: string; permissions?: string[] };

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

  async updateLeaveType(organizationId: string, id: string, dto: any) {
    await this.findLeaveType(organizationId, id);
    return this.prisma.leaveType.update({ where: { id }, data: dto });
  }

  async listLeaveTypes(organizationId: string) {
    return this.prisma.leaveType.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
  }

  private async findLeaveType(organizationId: string, id: string) {
    const leaveType = await this.prisma.leaveType.findFirst({ where: { id, organizationId } });
    if (!leaveType) throw new NotFoundException('Leave type not found');
    return leaveType;
  }

  // WBS 3.10 — submit a leave request. Does NOT check/reserve balance at
  // submission time on purpose — balance is only deducted on approval
  // (below), so a pending request can't lock days a manager might reject.
  // Day count skips the org's weekend days and holidays (WBS 1.14).
  async createRequest(organizationId: string, userId: string, dto: any) {
    const employee = await requireEmployeeForUser(this.prisma, organizationId, userId);
    await this.findLeaveType(organizationId, dto.leaveTypeId);
    const startDate = startOfDayUtc(new Date(dto.startDate));
    const endDate = startOfDayUtc(new Date(dto.endDate));

    if (endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate');
    }
    if (startDate.getUTCFullYear() !== endDate.getUTCFullYear()) {
      // Balances are per calendar year — split a request that crosses 31 Dec.
      throw new BadRequestException('A leave request cannot span two calendar years — submit one per year');
    }

    const overlapping = await this.prisma.leaveRequest.count({
      where: {
        employeeId: employee.id,
        status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlapping > 0) {
      throw new BadRequestException('You already have leave requested for some of these days');
    }

    const days = await countWorkingDays(this.prisma, organizationId, employee.branchId, startDate, endDate);
    if (days === 0) {
      throw new BadRequestException('These dates fall entirely on weekends or holidays');
    }

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

  // Approvers (hrm.leave.approve) see everyone's requests; everyone else
  // only ever sees their own, whatever employeeId they pass.
  async listRequests(organizationId: string, user: CallingUser, employeeId?: string, status?: string) {
    let targetEmployeeId = employeeId;
    if (!hasPermission(user, 'hrm.leave.approve')) {
      const own = await findEmployeeForUser(this.prisma, organizationId, user.id);
      if (!own) return [];
      if (employeeId && employeeId !== own.id) {
        throw new ForbiddenException('You can only view your own leave requests');
      }
      targetEmployeeId = own.id;
    }
    return this.prisma.leaveRequest.findMany({
      where: {
        organizationId,
        ...(targetEmployeeId && { employeeId: targetEmployeeId }),
        ...(status && { status: status as LeaveRequestStatus }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        leaveType: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      },
    });
  }

  // WBS 3.10 — approval. Deducts from LeaveBalance here. If no balance row
  // exists yet for the year, one is created with the leave type's
  // defaultAnnualDays as the allocation (no mid-year proration yet — WBS 3.9).
  async decide(organizationId: string, approverUserId: string, requestId: string, approve: boolean) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { leaveType: true },
    });
    if (!request) throw new NotFoundException('Leave request not found');
    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('This request has already been decided');
    }

    // The approver may be an HR admin with no employee profile — record the
    // employee when there is one, and the user in the audit trail always.
    const approver = await findEmployeeForUser(this.prisma, organizationId, approverUserId);
    if (approver?.id === request.employeeId) {
      throw new ForbiddenException('You cannot approve or reject your own leave request');
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: approve ? LeaveRequestStatus.APPROVED : LeaveRequestStatus.REJECTED,
        approverId: approver?.id ?? null,
        decidedAt: new Date(),
      },
    });

    if (approve) {
      await this.adjustUsedDays(request, request.days);
    }

    await this.prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId: approverUserId,
        eventType: approve ? 'leave.approved' : 'leave.rejected',
        entityType: 'LeaveRequest',
        entityId: requestId,
        metadata: { employeeId: request.employeeId, days: request.days },
      },
    });

    return updated;
  }

  // The requester can cancel their own PENDING request. An approver can also
  // cancel an APPROVED one (e.g. plans changed) — its days go back to the
  // balance.
  async cancel(organizationId: string, user: CallingUser, requestId: string) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, organizationId },
    });
    if (!request) throw new NotFoundException('Leave request not found');

    const own = await findEmployeeForUser(this.prisma, organizationId, user.id);
    const isOwner = own?.id === request.employeeId;
    const isApprover = hasPermission(user, 'hrm.leave.approve');

    if (request.status === LeaveRequestStatus.PENDING) {
      if (!isOwner && !isApprover) throw new ForbiddenException('You can only cancel your own requests');
    } else if (request.status === LeaveRequestStatus.APPROVED) {
      if (!isApprover) throw new ForbiddenException('Ask your manager or HR to cancel approved leave');
    } else {
      throw new BadRequestException(`A ${request.status.toLowerCase()} request cannot be cancelled`);
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: LeaveRequestStatus.CANCELLED },
    });
    if (request.status === LeaveRequestStatus.APPROVED) {
      await this.adjustUsedDays(request, -request.days);
    }
    await this.prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId: user.id,
        eventType: 'leave.cancelled',
        entityType: 'LeaveRequest',
        entityId: requestId,
        metadata: { previousStatus: request.status },
      },
    });
    return updated;
  }

  private async adjustUsedDays(
    request: { employeeId: string; leaveTypeId: string; startDate: Date },
    delta: number,
  ) {
    const year = request.startDate.getUTCFullYear();
    const leaveType = await this.prisma.leaveType.findUniqueOrThrow({ where: { id: request.leaveTypeId } });
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
        allocatedDays: leaveType.defaultAnnualDays,
        usedDays: Math.max(delta, 0),
      },
      update: { usedDays: { increment: delta } },
    });
  }

  // One row per leave type for the year: allocated / used / remaining. A
  // type with no balance row yet shows its defaultAnnualDays as allocated —
  // the same number approve() would create the row with.
  async balances(organizationId: string, user: CallingUser, employeeId?: string, year?: number) {
    const own = await findEmployeeForUser(this.prisma, organizationId, user.id);
    const targetId = employeeId ?? own?.id;
    if (!targetId) return [];
    if (targetId !== own?.id && !hasPermission(user, 'hrm.leave.approve')) {
      throw new ForbiddenException('You can only view your own leave balances');
    }
    const employee = await this.prisma.employee.findFirst({ where: { id: targetId, organizationId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const forYear = year ?? new Date().getUTCFullYear();
    const [types, rows] = await Promise.all([
      this.listLeaveTypes(organizationId),
      this.prisma.leaveBalance.findMany({ where: { employeeId: targetId, year: forYear } }),
    ]);
    return types.map((type) => {
      const row = rows.find((r) => r.leaveTypeId === type.id);
      const allocatedDays = row?.allocatedDays ?? type.defaultAnnualDays;
      const usedDays = row?.usedDays ?? 0;
      return {
        leaveType: type,
        year: forYear,
        allocatedDays,
        usedDays,
        remainingDays: allocatedDays - usedDays,
      };
    });
  }

  async setAllocation(organizationId: string, actorUserId: string, dto: any) {
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, organizationId } });
    if (!employee) throw new NotFoundException('Employee not found');
    await this.findLeaveType(organizationId, dto.leaveTypeId);

    const balance = await this.prisma.leaveBalance.upsert({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          year: dto.year,
        },
      },
      create: {
        employeeId: dto.employeeId,
        leaveTypeId: dto.leaveTypeId,
        year: dto.year,
        allocatedDays: dto.allocatedDays,
      },
      update: { allocatedDays: dto.allocatedDays },
    });
    await this.prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId,
        eventType: 'leave.allocation_set',
        entityType: 'LeaveBalance',
        entityId: balance.id,
        metadata: { employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year: dto.year, allocatedDays: dto.allocatedDays },
      },
    });
    return balance;
  }
}
