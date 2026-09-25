// WBS 4.14 — final settlement workflow: HR drafts it (hrm.payroll.run),
// can recalculate while it is a DRAFT, an approver approves it
// (hrm.payroll.approve), and it is marked PAID once the money has gone.
// Approval is what actually ends employment: the employee becomes
// TERMINATED with an exit date, their loans are closed, open leave
// requests are cancelled and their login is switched off.

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AttendanceStatus,
  EmployeeStatus,
  LeaveRequestStatus,
  PayrollRunStatus,
  Prisma,
  SettlementStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StatutoryEngineService } from './statutory-engine.service';
import { startOfDayUtc } from '../common/dates';
import { loadWorkCalendar } from '../common/work-calendar';
import { allocationForYear } from '../leave/entitlement';
import { unpaidDayWeights } from './unpaid-days';
import { computeSettlement } from './settlement';
import { UpsertFinalSettlementDto } from './dto/payroll.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OPEN_LEAVE = [LeaveRequestStatus.PENDING, LeaveRequestStatus.FIRST_APPROVED];

@Injectable()
export class SettlementService {
  constructor(
    private prisma: PrismaService,
    private statutoryEngine: StatutoryEngineService,
  ) {}

  async get(organizationId: string, employeeId: string) {
    await this.findEmployee(organizationId, employeeId);
    return this.prisma.finalSettlement.findUnique({ where: { employeeId } });
  }

  async upsertDraft(organizationId: string, actorUserId: string, employeeId: string, dto: UpsertFinalSettlementDto) {
    const employee = await this.findEmployee(organizationId, employeeId);
    if (employee.userId === actorUserId) {
      throw new ForbiddenException('You cannot prepare your own final settlement');
    }
    const existing = await this.prisma.finalSettlement.findUnique({ where: { employeeId } });
    if (existing && existing.status !== SettlementStatus.DRAFT) {
      throw new ConflictException(`This settlement is already ${existing.status.toLowerCase()} and can no longer change`);
    }
    if (employee.status === EmployeeStatus.TERMINATED) {
      throw new BadRequestException('This employee has already left');
    }
    const lastWorkingDay = startOfDayUtc(new Date(dto.lastWorkingDay));
    if (lastWorkingDay < startOfDayUtc(employee.dateOfJoining)) {
      throw new BadRequestException('The last working day cannot be before the joining date');
    }

    const calc = await this.calculate(organizationId, employee, lastWorkingDay, dto);
    const data = {
      lastWorkingDay,
      reason: dto.reason,
      currency: calc.currency,
      totalEarnings: calc.result.totalEarnings,
      totalDeductions: calc.result.totalDeductions,
      netAmount: calc.result.netAmount,
      breakdown: calc.result.lines as unknown as Prisma.InputJsonValue,
      inputs: { ...dto, lastWorkingDay: lastWorkingDay.toISOString(), ...calc.facts } as unknown as Prisma.InputJsonValue,
    };
    const settlement = existing
      ? await this.prisma.finalSettlement.update({ where: { id: existing.id }, data })
      : await this.prisma.finalSettlement.create({
          data: { organizationId, employeeId, createdByUserId: actorUserId, ...data },
        });
    await this.audit(organizationId, actorUserId, existing ? 'settlement.recalculated' : 'settlement.drafted', settlement.id, {
      employeeId,
      netAmount: calc.result.netAmount,
    });
    return settlement;
  }

  async approve(organizationId: string, actorUserId: string, id: string) {
    const settlement = await this.findSettlement(organizationId, id);
    if (settlement.status !== SettlementStatus.DRAFT) {
      throw new BadRequestException('Only a draft settlement can be approved');
    }
    const employee = await this.findEmployee(organizationId, settlement.employeeId);
    if (employee.userId === actorUserId) {
      throw new ForbiddenException('You cannot approve your own final settlement');
    }

    // Payroll may have been approved or a loan repaid since the draft was
    // calculated — then the numbers are stale.
    const inputs = settlement.inputs as any;
    const facts = await this.facts(organizationId, settlement.employeeId);
    if (facts.paidThrough !== inputs.paidThrough || JSON.stringify(facts.loans) !== JSON.stringify(inputs.loans)) {
      throw new ConflictException('Payroll or loans have changed since this was calculated — press Recalculate first');
    }

    const loanIds = (settlement.breakdown as any[]).filter((l) => l.type === 'loan_deduction').map((l) => l.sourceRef);
    const approved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.finalSettlement.update({
        where: { id },
        data: { status: SettlementStatus.APPROVED, approvedByUserId: actorUserId, approvedAt: new Date() },
      });
      await tx.employee.update({
        where: { id: settlement.employeeId },
        data: { status: EmployeeStatus.TERMINATED, exitDate: settlement.lastWorkingDay },
      });
      if (loanIds.length > 0) {
        await tx.employeeLoan.updateMany({
          where: { id: { in: loanIds } },
          data: { remainingBalance: 0, status: 'CLOSED' },
        });
      }
      await tx.leaveRequest.updateMany({
        where: { employeeId: settlement.employeeId, status: { in: OPEN_LEAVE } },
        data: { status: LeaveRequestStatus.CANCELLED },
      });
      if (employee.userId) {
        await tx.user.update({ where: { id: employee.userId }, data: { isActive: false } });
      }
      return updated;
    });
    await this.audit(organizationId, actorUserId, 'settlement.approved', id, {
      employeeId: settlement.employeeId,
      netAmount: Number(settlement.netAmount),
      loansClosed: loanIds,
    });
    return approved;
  }

  async markPaid(organizationId: string, actorUserId: string, id: string) {
    const settlement = await this.findSettlement(organizationId, id);
    if (settlement.status !== SettlementStatus.APPROVED) {
      throw new BadRequestException('Only an approved settlement can be marked as paid');
    }
    const paid = await this.prisma.finalSettlement.update({
      where: { id },
      data: { status: SettlementStatus.PAID, paidAt: new Date() },
    });
    await this.audit(organizationId, actorUserId, 'settlement.paid', id, { employeeId: settlement.employeeId });
    return paid;
  }

  async remove(organizationId: string, actorUserId: string, id: string) {
    const settlement = await this.findSettlement(organizationId, id);
    if (settlement.status !== SettlementStatus.DRAFT) {
      throw new BadRequestException('Only a draft settlement can be deleted');
    }
    await this.prisma.finalSettlement.delete({ where: { id } });
    await this.audit(organizationId, actorUserId, 'settlement.deleted', id, { employeeId: settlement.employeeId });
    return { deleted: true };
  }

  async pdfData(organizationId: string, id: string) {
    const settlement = await this.findSettlement(organizationId, id);
    const [employee, organization] = await Promise.all([
      this.prisma.employee.findUniqueOrThrow({ where: { id: settlement.employeeId } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    ]);
    return {
      organizationName: organization.name,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNumber: employee.employeeNumber,
      designation: employee.designation,
      dateOfJoining: employee.dateOfJoining,
      lastWorkingDay: settlement.lastWorkingDay,
      reason: settlement.reason,
      status: settlement.status,
      currency: settlement.currency,
      totalEarnings: Number(settlement.totalEarnings),
      totalDeductions: Number(settlement.totalDeductions),
      netAmount: Number(settlement.netAmount),
      breakdown: settlement.breakdown as any[],
      notes: ((settlement.inputs as any)?.warnings ?? []) as string[],
    };
  }

  // --- internals ----------------------------------------------------------

  private async findEmployee(organizationId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  private async findSettlement(organizationId: string, id: string) {
    const settlement = await this.prisma.finalSettlement.findFirst({ where: { id, organizationId } });
    if (!settlement) throw new NotFoundException('Final settlement not found');
    return settlement;
  }

  // What payroll already paid and what is still owed on loans — stored with
  // the draft so approval can tell whether it went stale.
  private async facts(organizationId: string, employeeId: string) {
    const [lastPaid, loans] = await Promise.all([
      this.prisma.payrollLineItem.findFirst({
        where: {
          employeeId,
          payrollRun: { organizationId, status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.LOCKED] } },
        },
        orderBy: { payrollRun: { periodEnd: 'desc' } },
        include: { payrollRun: true },
      }),
      this.prisma.employeeLoan.findMany({
        where: { employeeId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
      }),
    ]);
    return {
      paidThrough: lastPaid ? startOfDayUtc(lastPaid.payrollRun.periodEnd).toISOString() : null,
      loans: loans.map((l) => ({ id: l.id, remainingBalance: Number(l.remainingBalance) })),
    };
  }

  private async calculate(
    organizationId: string,
    employee: Awaited<ReturnType<SettlementService['findEmployee']>>,
    lastWorkingDay: Date,
    dto: UpsertFinalSettlementDto,
  ) {
    const structure = await this.prisma.employeeSalaryStructure.findUnique({
      where: { employeeId: employee.id },
      include: { components: { include: { component: true } } },
    });
    if (!structure) throw new BadRequestException('Add a salary structure for this employee first');

    const facts = await this.facts(organizationId, employee.id);
    const warnings: string[] = [];

    const basic = Number(structure.basicSalary);
    let gross = basic;
    let taxable = basic;
    for (const c of structure.components) {
      if (c.component.type !== 'EARNING') continue;
      gross += Number(c.amount);
      if (c.component.isTaxable) taxable += Number(c.amount);
    }

    // Normal month's effective tax rate, applied to the settlement's salary.
    let monthlyTaxRate = 0;
    if (employee.countryCode && taxable > 0) {
      const tax = await this.statutoryEngine.calculateIncomeTax(
        employee.countryCode,
        employee.regionCode ?? undefined,
        taxable,
        lastWorkingDay,
      );
      monthlyTaxRate = tax ? tax.employeeAmount / taxable : 0;
    } else if (!employee.countryCode) {
      warnings.push('No country set on this employee, so no income tax was worked out.');
    }

    // Unpaid days between the last paid period and the last working day.
    const paidThrough = facts.paidThrough ? new Date(facts.paidThrough) : null;
    const spanStart = paidThrough ? new Date(paidThrough.getTime() + MS_PER_DAY) : startOfDayUtc(employee.dateOfJoining);
    let unpaidWeights = new Map<string, number>();
    if (spanStart <= lastWorkingDay) {
      const [unpaidLeave, absences, calendar] = await Promise.all([
        this.prisma.leaveRequest.findMany({
          where: {
            employeeId: employee.id,
            status: LeaveRequestStatus.APPROVED,
            leaveType: { isPaid: false },
            startDate: { lte: lastWorkingDay },
            endDate: { gte: spanStart },
          },
        }),
        this.prisma.attendanceRecord.findMany({
          where: {
            employeeId: employee.id,
            date: { gte: spanStart, lte: lastWorkingDay },
            status: { in: [AttendanceStatus.ABSENT, AttendanceStatus.HALF_DAY] },
          },
        }),
        loadWorkCalendar(this.prisma, organizationId, employee.branchId, spanStart, lastWorkingDay),
      ]);
      unpaidWeights = unpaidDayWeights({
        periodStart: spanStart,
        periodEnd: lastWorkingDay,
        dateOfJoining: employee.dateOfJoining,
        unpaidLeave,
        absences,
        weekendDays: calendar.weekendDays,
        holidayKeys: calendar.holidayKeys,
      });
    }

    // Unused encashable leave, earned up to the last working day: the
    // yearly quota counts month by month here even for up-front (ANNUAL)
    // types, so leaving in March doesn't pay out a whole year's leave.
    const year = lastWorkingDay.getUTCFullYear();
    const encashableTypes = await this.prisma.leaveType.findMany({
      where: { organizationId, isEncashable: true, isPaid: true },
      orderBy: { name: 'asc' },
    });
    const encashableLeave: { leaveTypeName: string; days: number }[] = [];
    for (const type of encashableTypes) {
      const rows = await this.prisma.leaveBalance.findMany({
        where: { employeeId: employee.id, leaveTypeId: type.id, year: { lte: year } },
      });
      const byYear = new Map(rows.map((r) => [r.year, r]));
      const allocated = allocationForYear(
        {
          accrual: 'MONTHLY',
          yearlyDays: type.defaultAnnualDays,
          maxCarryForwardDays: type.maxCarryForwardDays,
          dateOfJoining: employee.dateOfJoining,
          asOf: lastWorkingDay,
          rows: byYear,
        },
        year,
      );
      const days = Math.max(0, allocated - (byYear.get(year)?.usedDays ?? 0));
      encashableLeave.push({ leaveTypeName: type.name, days });
    }

    const openRuns = await this.prisma.payrollRun.count({
      where: {
        organizationId,
        status: { in: [PayrollRunStatus.DRAFT, PayrollRunStatus.SUBMITTED] },
        lineItems: { some: { employeeId: employee.id } },
      },
    });
    if (openRuns > 0) {
      warnings.push(
        'A payroll run that is not approved yet includes this employee. After approving this settlement, recalculate that run — leavers are left out — so they are not paid twice.',
      );
    }
    if (encashableTypes.length === 0) {
      warnings.push('No leave type is marked as encashable, so no leave was paid out.');
    }
    if ((dto.noticeDaysInLieu ?? 0) > 0 && (dto.noticeDaysShort ?? 0) > 0) {
      warnings.push('Both notice pay and notice recovery are set — usually only one applies.');
    }
    warnings.push('Tax on leave encashment and gratuity, and social security on the final salary, are not included — check with your accountant.');

    const result = computeSettlement({
      dateOfJoining: employee.dateOfJoining,
      lastWorkingDay,
      paidThrough,
      basicMonthly: basic,
      grossMonthly: gross,
      taxableShare: gross > 0 ? taxable / gross : 0,
      monthlyTaxRate,
      unpaidWeights,
      encashableLeave,
      includeGratuity: dto.includeGratuity ?? false,
      noticeDaysInLieu: dto.noticeDaysInLieu ?? 0,
      noticeDaysShort: dto.noticeDaysShort ?? 0,
      loans: facts.loans,
      adjustments: dto.adjustments ?? [],
    });
    return { currency: structure.currency, result, facts: { ...facts, warnings } };
  }

  private audit(organizationId: string, actorUserId: string, eventType: string, entityId: string, metadata: object) {
    return this.prisma.auditEvent.create({
      data: { organizationId, actorUserId, eventType, entityType: 'FinalSettlement', entityId, metadata },
    });
  }
}
