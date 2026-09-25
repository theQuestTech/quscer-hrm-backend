import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Employee, LeaveRequestStatus, LeaveType } from '@prisma/client';
import { startOfDayUtc, todayInTimeZone } from '../common/dates';
import { allocationForYear } from './entitlement';
import { countWorkingDays } from '../common/work-calendar';
import { findEmployeeForUser, requireEmployeeForUser } from '../common/current-employee';
import { hasPermission } from '../rbac/rbac.service';
import { approverScope, assertInScope } from '../common/approver-scope';

type CallingUser = { id: string; permissions?: string[] };

// Requests still waiting on someone — they hold days against the balance.
const OPEN_STATUSES = [LeaveRequestStatus.PENDING, LeaveRequestStatus.FIRST_APPROVED];

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
        accrual: dto.accrual,
        maxCarryForwardDays: dto.maxCarryForwardDays,
        isEncashable: dto.isEncashable,
        allowNegativeBalance: dto.allowNegativeBalance,
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

  // WBS 3.10 — submit a leave request. Days are only deducted on final
  // approval, but a paid type (unless it allows going negative) must have
  // enough balance left after the employee's other open requests.
  // Day count skips the org's weekend days and holidays (WBS 1.14).
  async createRequest(organizationId: string, userId: string, dto: any) {
    const employee = await requireEmployeeForUser(this.prisma, organizationId, userId);
    const leaveType = await this.findLeaveType(organizationId, dto.leaveTypeId);
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
        status: { in: [...OPEN_STATUSES, LeaveRequestStatus.APPROVED] },
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
    await this.assertEnoughBalance(organizationId, employee, leaveType, startDate, days);

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

  // HR approvers see everyone's requests, a manager sees their team's (and
  // their own), and everyone else only ever sees their own, whatever
  // employeeId they pass.
  async listRequests(organizationId: string, user: CallingUser, employeeId?: string, status?: string) {
    let targetEmployeeId = employeeId;
    let teamIds: string[] | undefined;
    const own = await findEmployeeForUser(this.prisma, organizationId, user.id);
    if (!hasPermission(user, 'hrm.leave.approve')) {
      if (!own) return [];
      if (employeeId && employeeId !== own.id) {
        throw new ForbiddenException('You can only view your own leave requests');
      }
      targetEmployeeId = own.id;
    } else {
      const scope = await approverScope(this.prisma, organizationId, user);
      if (scope) {
        if (employeeId) {
          if (employeeId !== own?.id) assertInScope(scope, employeeId);
        } else {
          teamIds = own ? [...scope, own.id] : scope;
        }
      }
    }
    return this.prisma.leaveRequest.findMany({
      where: {
        organizationId,
        ...(targetEmployeeId && { employeeId: targetEmployeeId }),
        ...(teamIds && { employeeId: { in: teamIds } }),
        ...(status && { status: status as LeaveRequestStatus }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        leaveType: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      },
    });
  }

  // WBS 3.10 — approval. With one approval step the first "approve" is
  // final. With two (org setting), the first moves the request to
  // FIRST_APPROVED and a different person must give the final approval.
  // Days come off the balance only on final approval. Either step can reject.
  async decide(organizationId: string, user: CallingUser, requestId: string, approve: boolean) {
    const approverUserId = user.id;
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { leaveType: true, employee: true },
    });
    if (!request) throw new NotFoundException('Leave request not found');
    if (!OPEN_STATUSES.includes(request.status as any)) {
      throw new BadRequestException('This request has already been decided');
    }

    // The approver may be an HR admin with no employee profile — record the
    // employee when there is one, and the user in the audit trail always.
    const approver = await findEmployeeForUser(this.prisma, organizationId, approverUserId);
    if (approver?.id === request.employeeId) {
      throw new ForbiddenException('You cannot approve or reject your own leave request');
    }
    assertInScope(await approverScope(this.prisma, organizationId, user), request.employeeId);

    const settings = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    const needsTwoSteps = (settings?.leaveApprovalSteps ?? 1) >= 2;
    const isFirstStep = approve && needsTwoSteps && request.status === LeaveRequestStatus.PENDING;

    if (request.status === LeaveRequestStatus.FIRST_APPROVED && request.firstApproverUserId === approverUserId) {
      throw new ForbiddenException('The final approval must come from a different person than the first');
    }
    if (approve && !isFirstStep) {
      // Balance may have changed since the request was made (another request
      // approved, allocation lowered) — check again before deducting.
      await this.assertEnoughBalance(
        organizationId,
        request.employee,
        request.leaveType,
        request.startDate,
        request.days,
        request.id,
      );
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: isFirstStep
        ? { status: LeaveRequestStatus.FIRST_APPROVED, firstApproverUserId: approverUserId, firstApprovedAt: new Date() }
        : {
            status: approve ? LeaveRequestStatus.APPROVED : LeaveRequestStatus.REJECTED,
            approverId: approver?.id ?? null,
            decidedAt: new Date(),
          },
    });

    if (approve && !isFirstStep) {
      await this.adjustUsedDays(request, request.days);
    }

    await this.prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId: approverUserId,
        eventType: isFirstStep ? 'leave.first_approved' : approve ? 'leave.approved' : 'leave.rejected',
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

    if (OPEN_STATUSES.includes(request.status as any)) {
      if (!isOwner && !isApprover) throw new ForbiddenException('You can only cancel your own requests');
    } else if (request.status === LeaveRequestStatus.APPROVED) {
      if (!isApprover) throw new ForbiddenException('Ask your manager or HR to cancel approved leave');
      assertInScope(await approverScope(this.prisma, organizationId, user), request.employeeId);
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
    // allocatedDays on a non-manual row is not read back — the allocation is
    // always recomputed from the leave type's rules (see allocationForYear).
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
        usedDays: Math.max(delta, 0),
      },
      update: { usedDays: { increment: delta } },
    });
  }

  // One row per leave type for the year: allocated / used / pending /
  // remaining. Allocation follows the type's accrual and carry-forward rules
  // unless HR set a manual figure for that year.
  async balances(organizationId: string, user: CallingUser, employeeId?: string, year?: number) {
    const own = await findEmployeeForUser(this.prisma, organizationId, user.id);
    const targetId = employeeId ?? own?.id;
    if (!targetId) return [];
    if (targetId !== own?.id) {
      if (!hasPermission(user, 'hrm.leave.approve')) {
        throw new ForbiddenException('You can only view your own leave balances');
      }
      assertInScope(await approverScope(this.prisma, organizationId, user), targetId);
    }
    const employee = await this.prisma.employee.findFirst({ where: { id: targetId, organizationId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const today = await this.orgToday(organizationId);
    const forYear = year ?? today.getUTCFullYear();
    const types = await this.listLeaveTypes(organizationId);
    return Promise.all(types.map((type) => this.balanceFor(employee, type, forYear, today)));
  }

  // Balance of one leave type for one year. `excludeRequestId` leaves a
  // request out of the pending count (when re-checking that same request).
  async balanceFor(
    employee: Pick<Employee, 'id' | 'dateOfJoining'>,
    type: LeaveType,
    year: number,
    asOf: Date,
    excludeRequestId?: string,
  ) {
    const [rows, pending] = await Promise.all([
      this.prisma.leaveBalance.findMany({
        where: { employeeId: employee.id, leaveTypeId: type.id, year: { lte: year } },
      }),
      this.prisma.leaveRequest.aggregate({
        _sum: { days: true },
        where: {
          employeeId: employee.id,
          leaveTypeId: type.id,
          status: { in: OPEN_STATUSES },
          startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
          ...(excludeRequestId && { id: { not: excludeRequestId } }),
        },
      }),
    ]);
    const byYear = new Map(rows.map((r) => [r.year, r]));
    const allocatedDays = allocationForYear(
      {
        accrual: type.accrual,
        yearlyDays: type.defaultAnnualDays,
        maxCarryForwardDays: type.maxCarryForwardDays,
        dateOfJoining: employee.dateOfJoining,
        asOf,
        rows: byYear,
      },
      year,
    );
    const usedDays = byYear.get(year)?.usedDays ?? 0;
    const pendingDays = pending._sum.days ?? 0;
    return {
      leaveType: type,
      year,
      allocatedDays,
      usedDays,
      pendingDays,
      remainingDays: allocatedDays - usedDays,
      isManualAllocation: byYear.get(year)?.isManualAllocation ?? false,
    };
  }

  private async assertEnoughBalance(
    organizationId: string,
    employee: Pick<Employee, 'id' | 'dateOfJoining'>,
    type: LeaveType,
    startDate: Date,
    days: number,
    excludeRequestId?: string,
  ) {
    if (!type.isPaid || type.allowNegativeBalance) return;
    const today = await this.orgToday(organizationId);
    // Monthly accrual: count what will have accrued by the leave's start.
    const asOf = startDate > today ? startDate : today;
    const balance = await this.balanceFor(employee, type, startDate.getUTCFullYear(), asOf, excludeRequestId);
    const available = balance.remainingDays - balance.pendingDays;
    if (days > available) {
      throw new BadRequestException(
        `Not enough ${type.name} leave: ${days} day(s) requested, ${Math.max(available, 0)} available` +
          (balance.pendingDays > 0 ? ` (${balance.pendingDays} day(s) already waiting for approval)` : ''),
      );
    }
  }

  private async orgToday(organizationId: string) {
    const settings = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    return todayInTimeZone(settings?.defaultTimezone);
  }

  async setAllocation(organizationId: string, user: CallingUser, dto: any) {
    const actorUserId = user.id;
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, organizationId } });
    if (!employee) throw new NotFoundException('Employee not found');
    assertInScope(await approverScope(this.prisma, organizationId, user), employee.id);
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
        allocatedDays: dto.allocatedDays ?? 0,
        isManualAllocation: dto.allocatedDays !== null,
      },
      update: { allocatedDays: dto.allocatedDays ?? 0, isManualAllocation: dto.allocatedDays !== null },
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
