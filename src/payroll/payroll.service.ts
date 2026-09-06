import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StatutoryEngineService } from './statutory-engine.service';
import { PayrollRunStatus, EmployeeStatus } from '@prisma/client';

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private statutoryEngine: StatutoryEngineService,
  ) {}

  // ---------------------------------------------------------------------
  // WBS 4.2/4.3 — salary structure
  // ---------------------------------------------------------------------

  async upsertSalaryStructure(organizationId: string, employeeId: string, dto: any) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const structure = await this.prisma.employeeSalaryStructure.upsert({
      where: { employeeId },
      create: {
        employeeId,
        currency: dto.currency,
        basicSalary: dto.basicSalary,
        effectiveFrom: new Date(dto.effectiveFrom),
      },
      update: {
        currency: dto.currency,
        basicSalary: dto.basicSalary,
        effectiveFrom: new Date(dto.effectiveFrom),
      },
    });

    // Replace components wholesale on update — simpler and safer than
    // diffing for a first version; revisit if partial updates matter later.
    if (dto.components) {
      await this.prisma.employeeSalaryComponent.deleteMany({
        where: { salaryStructureId: structure.id },
      });
      for (const c of dto.components) {
        const component = await this.prisma.salaryComponent.upsert({
          where: { organizationId_name: { organizationId, name: c.name } },
          create: { organizationId, name: c.name, type: c.type, isTaxable: c.isTaxable ?? true },
          update: {},
        });
        await this.prisma.employeeSalaryComponent.create({
          data: { salaryStructureId: structure.id, componentId: component.id, amount: c.amount },
        });
      }
    }

    return this.prisma.employeeSalaryStructure.findUnique({
      where: { employeeId },
      include: { components: { include: { component: true } } },
    });
  }

  // ---------------------------------------------------------------------
  // WBS 4.1/4.6/4.7 — payroll run: create draft, then calculate every
  // active employee's line item via the statutory engine.
  // ---------------------------------------------------------------------

  async createRun(organizationId: string, userId: string, dto: any) {
    let run;
    try {
      run = await this.prisma.payrollRun.create({
        data: {
          organizationId,
          periodStart: new Date(dto.periodStart),
          periodEnd: new Date(dto.periodEnd),
          payDate: new Date(dto.payDate),
          status: PayrollRunStatus.DRAFT,
          runByUserId: userId,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('A payroll run already exists for this period');
      }
      throw e;
    }
    return this.calculate(organizationId, run.id);
  }

  // Recalculates every active employee's line item for a DRAFT run. Safe
  // to call repeatedly — clears and rebuilds line items each time — but
  // refuses once the run has moved past DRAFT (see 4.8's "recalculation"
  // scope: recalculation is a draft-only operation, not a live edit to
  // something already submitted for approval).
  async calculate(organizationId: string, runId: string) {
    const run = await this.getRunOrThrow(organizationId, runId);
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot recalculate a run in status ${run.status} — only DRAFT runs can be recalculated`,
      );
    }

    const employees = await this.prisma.employee.findMany({
      where: { organizationId, status: EmployeeStatus.ACTIVE },
      include: {
        salaryStructure: { include: { components: { include: { component: true } } } },
        loans: { where: { status: 'ACTIVE' } },
      },
    });

    await this.prisma.payrollLineItem.deleteMany({ where: { payrollRunId: runId } });

    const skippedNoSalaryStructure: string[] = [];
    const skippedNoJurisdiction: string[] = [];

    for (const employee of employees) {
      if (!employee.salaryStructure) {
        skippedNoSalaryStructure.push(employee.id);
        continue;
      }
      if (!employee.countryCode) {
        skippedNoJurisdiction.push(employee.id);
        continue;
      }

      const breakdown: any[] = [];
      const basic = Number(employee.salaryStructure.basicSalary);
      let totalEarnings = basic;
      breakdown.push({ label: 'Basic', type: 'earning', amount: basic });

      for (const ec of employee.salaryStructure.components) {
        const amt = Number(ec.amount);
        if (ec.component.type === 'EARNING') {
          totalEarnings += amt;
          breakdown.push({ label: ec.component.name, type: 'earning', amount: amt });
        }
      }
      const grossSalary = totalEarnings;

      let totalDeductions = 0;

      // Fixed salary-structure deductions (e.g. a flat provident fund line)
      for (const ec of employee.salaryStructure.components) {
        if (ec.component.type === 'DEDUCTION') {
          const amt = Number(ec.amount);
          totalDeductions += amt;
          breakdown.push({ label: ec.component.name, type: 'deduction', amount: amt });
        }
      }

      // Statutory deductions, via the engine — this is the part that's
      // identical code regardless of which country the employee is in.
      const asOf = run.periodStart;
      const incomeTax = await this.statutoryEngine.calculateIncomeTax(
        employee.countryCode, employee.regionCode ?? undefined, grossSalary, asOf,
      );
      if (incomeTax && incomeTax.employeeAmount > 0) {
        totalDeductions += incomeTax.employeeAmount;
        breakdown.push({
          label: incomeTax.label, type: 'statutory_deduction',
          amount: incomeTax.employeeAmount, sourceRef: incomeTax.ruleId,
        });
      }

      const pension = await this.statutoryEngine.calculatePensionFund(
        employee.countryCode, employee.regionCode ?? undefined, undefined, asOf,
      );
      if (pension) {
        if (pension.employeeAmount > 0) {
          totalDeductions += pension.employeeAmount;
          breakdown.push({
            label: pension.label, type: 'statutory_deduction',
            amount: pension.employeeAmount, sourceRef: pension.ruleId,
          });
        }
        if (pension.employerAmount > 0) {
          breakdown.push({
            label: `${pension.label} (Employer)`, type: 'employer_contribution',
            amount: pension.employerAmount, sourceRef: pension.ruleId,
          });
        }
      }

      const socialSecurity = await this.statutoryEngine.calculateSocialSecurity(
        employee.countryCode, employee.regionCode ?? undefined, grossSalary, asOf,
      );
      if (socialSecurity) {
        if (socialSecurity.employeeAmount > 0) {
          totalDeductions += socialSecurity.employeeAmount;
          breakdown.push({
            label: socialSecurity.label, type: 'statutory_deduction',
            amount: socialSecurity.employeeAmount, sourceRef: socialSecurity.ruleId,
          });
        }
        if (socialSecurity.employerAmount > 0) {
          breakdown.push({
            label: `${socialSecurity.label} (Employer)`, type: 'employer_contribution',
            amount: socialSecurity.employerAmount, sourceRef: socialSecurity.ruleId,
          });
        }
      }

      // Loan deductions — WBS 4.12. Capped at remaining balance so the
      // last installment doesn't overshoot. Balance is only decremented on
      // APPROVAL (see approve() below), not here — draft calculation must
      // stay side-effect-free so recalculation is safe to run repeatedly.
      for (const loan of employee.loans) {
        const installment = Math.min(
          Number(loan.installmentAmount),
          Number(loan.remainingBalance),
        );
        if (installment > 0) {
          totalDeductions += installment;
          breakdown.push({
            label: 'Loan Installment', type: 'loan_deduction',
            amount: installment, sourceRef: loan.id,
          });
        }
      }

      const netSalary = grossSalary - totalDeductions;

      await this.prisma.payrollLineItem.create({
        data: {
          payrollRunId: runId,
          employeeId: employee.id,
          currency: employee.salaryStructure.currency,
          grossSalary,
          totalEarnings,
          totalDeductions,
          netSalary,
          breakdown,
        },
      });
    }

    return {
      run: await this.getRunOrThrow(organizationId, runId),
      warnings: {
        skippedNoSalaryStructure,
        skippedNoJurisdiction,
      },
    };
  }

  // ---------------------------------------------------------------------
  // WBS 4.9 — maker-checker approval
  // ---------------------------------------------------------------------

  async submit(organizationId: string, runId: string) {
    const run = await this.getRunOrThrow(organizationId, runId);
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException('Only a DRAFT run can be submitted');
    }
    const lineItemCount = await this.prisma.payrollLineItem.count({
      where: { payrollRunId: runId },
    });
    if (lineItemCount === 0) {
      throw new BadRequestException('Cannot submit a run with no calculated line items');
    }
    return this.prisma.payrollRun.update({
      where: { id: runId },
      data: { status: PayrollRunStatus.SUBMITTED, submittedAt: new Date() },
    });
  }

  // The "checker" half of maker-checker. Enforced at the controller level
  // via a separate permission (hrm.payroll.approve vs hrm.payroll.run) —
  // this method doesn't itself check who's calling, that's the guard's job.
  async approve(organizationId: string, approverUserId: string, runId: string) {
    const run = await this.getRunOrThrow(organizationId, runId);
    if (run.status !== PayrollRunStatus.SUBMITTED) {
      throw new BadRequestException('Only a SUBMITTED run can be approved');
    }

    const lineItems = await this.prisma.payrollLineItem.findMany({
      where: { payrollRunId: runId },
    });

    // Decrement loan balances now — the one side effect deferred from
    // calculate() until the run is actually approved, not just previewed.
    for (const item of lineItems) {
      const breakdown = item.breakdown as any[];
      for (const line of breakdown) {
        if (line.type === 'loan_deduction') {
          await this.prisma.employeeLoan.update({
            where: { id: line.sourceRef },
            data: { remainingBalance: { decrement: line.amount } },
          });
        }
      }
    }
    // Close out any loan that's now fully repaid.
    await this.prisma.employeeLoan.updateMany({
      where: { status: 'ACTIVE', remainingBalance: { lte: 0 } },
      data: { status: 'CLOSED' },
    });

    return this.prisma.payrollRun.update({
      where: { id: runId },
      data: {
        status: PayrollRunStatus.APPROVED,
        approvedByUserId: approverUserId,
        approvedAt: new Date(),
      },
    });
  }

  async getRunOrThrow(organizationId: string, runId: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, organizationId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  async getRunWithLineItems(organizationId: string, runId: string) {
    await this.getRunOrThrow(organizationId, runId);
    return this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: { lineItems: { include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } } } },
    });
  }

  async listRuns(organizationId: string) {
    return this.prisma.payrollRun.findMany({
      where: { organizationId },
      orderBy: { periodStart: 'desc' },
    });
  }

  // ---------------------------------------------------------------------
  // WBS 4.12 — loans
  // ---------------------------------------------------------------------

  async createLoan(organizationId: string, employeeId: string, dto: any) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return this.prisma.employeeLoan.create({
      data: {
        employeeId,
        principal: dto.principal,
        installmentAmount: dto.installmentAmount,
        remainingBalance: dto.principal,
        startDate: new Date(dto.startDate),
      },
    });
  }

  async listLoans(organizationId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return this.prisma.employeeLoan.findMany({ where: { employeeId } });
  }

  // ---------------------------------------------------------------------
  // WBS 4.10 — payslip data. PDF-only available once a run is APPROVED or
  // LOCKED — a draft/submitted run's numbers can still change, and an
  // employee should never see a payslip that might be wrong tomorrow.
  // Admins previewing draft numbers use GET /payroll-runs/:id (JSON) instead.
  // ---------------------------------------------------------------------

  async getPayslipData(organizationId: string, runId: string, employeeId: string) {
    const run = await this.getRunOrThrow(organizationId, runId);
    if (run.status !== PayrollRunStatus.APPROVED && run.status !== PayrollRunStatus.LOCKED) {
      throw new BadRequestException(
        'Payslip is only available once the payroll run has been approved',
      );
    }

    const lineItem = await this.prisma.payrollLineItem.findUnique({
      where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } },
      include: { employee: true },
    });
    if (!lineItem) throw new NotFoundException('No payslip found for this employee in this run');

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    return { run, lineItem, organization };
  }

  // Duplicated from attendance/leave services (same User->Employee
  // resolution pattern) — worth pulling into a shared helper once a third
  // or fourth module needs it; not done yet to avoid a premature
  // abstraction across modules that don't share a parent yet.
  async resolveEmployeeForUser(organizationId: string, userId: string) {
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
}
