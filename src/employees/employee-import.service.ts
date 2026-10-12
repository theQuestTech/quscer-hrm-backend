// Bulk employee import from HR's spreadsheet. The screen reads the file and
// sends its rows; check() says what's wrong with each row without saving;
// run() saves everyone in one go, or nothing if any row still has a problem.

import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FieldEncryptionService } from '../crypto/field-encryption.service';
import { TwoStepService } from '../two-step/two-step.service';
import { PunchService } from '../attendance-devices/punch.service';
import { UsersService } from '../users/users.service';
import { hasPermission } from '../rbac/rbac.service';
import { normalizeMachineId } from '../attendance-devices/punch-rules';
import { CheckedRow, ImportRow, MAX_ROWS, checkRows } from './import-rules';

type Caller = { id: string; organizationId: string; permissions?: string[] };

@Injectable()
export class EmployeeImportService {
  private readonly log = new Logger('EmployeeImport');

  constructor(
    private prisma: PrismaService,
    private fieldEncryption: FieldEncryptionService,
    private twoStep: TwoStepService,
    private punches: PunchService,
    private users: UsersService,
  ) {}

  async check(caller: Caller, rows: ImportRow[]) {
    if (!rows.length) throw new BadRequestException('The file has no rows');
    if (rows.length > MAX_ROWS) throw new BadRequestException(`At most ${MAX_ROWS} people per file — split it and import in parts`);
    const organizationId = caller.organizationId;
    const [branches, departments, shifts, existing] = await Promise.all([
      this.prisma.branch.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      this.prisma.department.findMany({ where: { organizationId }, select: { id: true, name: true, branchId: true } }),
      this.prisma.shift.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      this.prisma.employee.findMany({ where: { organizationId }, select: { id: true, employeeNumber: true, email: true, cnic: true, machineUserId: true } }),
    ]);
    // Machines send "00012" for "12": compare them the same way the app stores them.
    const normalised = rows.map((r) => (r.machineUserId?.trim() ? { ...r, machineUserId: normalizeMachineId(r.machineUserId) } : r));
    const checked = checkRows(normalised, { branches, departments, shifts, existing });

    // Salary needs payroll access, like on the employee page.
    if (!hasPermission(caller, 'hrm.payroll.write')) {
      for (const r of checked) {
        if (r.data?.basicSalary !== undefined || (r.problems.length === 0 && normalised[r.line - 2].basicSalary?.trim())) {
          r.problems.push("You can't set salaries — leave the salary column empty, or ask someone with payroll access to import");
          r.data = undefined;
        }
      }
    }
    return checked;
  }

  private summary(checked: CheckedRow[]) {
    const ok = checked.filter((r) => r.data);
    return {
      total: checked.length,
      ready: ok.length,
      withProblems: checked.length - ok.length,
      withBank: ok.filter((r) => r.data!.bank).length,
      withSalary: ok.filter((r) => r.data!.basicSalary !== undefined).length,
      withManager: ok.filter((r) => r.data!.managerNumber).length,
    };
  }

  async preview(caller: Caller, rows: ImportRow[]) {
    const checked = await this.check(caller, rows);
    return { summary: this.summary(checked), rows: checked.map(({ data: _d, ...r }) => ({ ...r, ok: !!_d })) };
  }

  async run(req: any, rows: ImportRow[], giveLogin: boolean) {
    const caller: Caller = req.user;
    const organizationId = caller.organizationId;
    const checked = await this.check(caller, rows);
    const bad = checked.filter((r) => !r.data);
    if (bad.length) {
      throw new BadRequestException(`${bad.length} row${bad.length === 1 ? ' has' : 's have'} problems — fix ${bad.length === 1 ? 'it' : 'them'} and check the file again`);
    }
    const ready = checked.map((r) => r.data!);
    // Bank account numbers: same two-step check as adding one on the employee page.
    if (ready.some((r) => r.bank)) await this.twoStep.requireCode(req);
    if (giveLogin && !hasPermission(caller, 'hrm.settings.write')) {
      throw new ForbiddenException('Giving logins needs settings access — import without logins, or ask an HR admin');
    }

    const settings = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    const currency = settings?.defaultCurrency ?? 'PKR';

    const created = await this.prisma.$transaction(
      async (tx) => {
        const ids = new Map<string, string>(); // employee number (lower case) → id
        for (const r of ready) {
          const e = await tx.employee.create({
            data: {
              organizationId,
              employeeNumber: r.employeeNumber,
              firstName: r.firstName,
              lastName: r.lastName,
              email: r.email,
              phone: r.phone,
              designation: r.designation,
              employmentType: r.employmentType,
              dateOfJoining: new Date(r.dateOfJoining),
              dateOfBirth: r.dateOfBirth ? new Date(r.dateOfBirth) : undefined,
              branchId: r.branchId,
              departmentId: r.departmentId,
              shiftId: r.shiftId,
              cnic: r.cnic,
              fatherName: r.fatherName,
              gender: r.gender,
              maritalStatus: r.maritalStatus,
              bloodGroup: r.bloodGroup,
              personalEmail: r.personalEmail,
              address: r.address,
              city: r.city,
              machineUserId: r.machineUserId,
            },
          });
          ids.set(r.employeeNumber.toLowerCase(), e.id);
          await tx.auditEvent.create({
            data: { organizationId, actorUserId: caller.id, eventType: 'employee.created', entityType: 'Employee', entityId: e.id, metadata: { employeeNumber: e.employeeNumber, imported: true } },
          });
          if (r.bank) {
            const digits = r.bank.accountNumber;
            await tx.employeeBankDetail.create({
              data: {
                employeeId: e.id,
                bankName: r.bank.bankName,
                accountTitle: r.bank.accountTitle,
                branchCode: r.bank.branchCode,
                accountNumber: this.fieldEncryption.encrypt(digits),
                accountNumberLast4: digits.slice(-4),
              },
            });
            await tx.auditEvent.create({
              data: {
                organizationId, actorUserId: caller.id, eventType: 'employee.bank_added', entityType: 'Employee', entityId: e.id,
                metadata: { employee: `${r.firstName} ${r.lastName}`, newLast4: digits.slice(-4), imported: true },
              },
            });
          }
          if (r.basicSalary !== undefined) {
            await tx.employeeSalaryStructure.create({
              data: { employeeId: e.id, currency, basicSalary: r.basicSalary, effectiveFrom: new Date(r.dateOfJoining) },
            });
          }
        }
        // Managers, once everyone in the file exists.
        const withManager = ready.filter((r) => r.managerNumber);
        if (withManager.length) {
          const existing = await tx.employee.findMany({
            where: { organizationId, employeeNumber: { in: withManager.map((r) => r.managerNumber!), mode: 'insensitive' } },
            select: { id: true, employeeNumber: true },
          });
          for (const e of existing) if (!ids.has(e.employeeNumber.toLowerCase())) ids.set(e.employeeNumber.toLowerCase(), e.id);
          for (const r of withManager) {
            await tx.employee.update({ where: { id: ids.get(r.employeeNumber.toLowerCase())! }, data: { managerId: ids.get(r.managerNumber!.toLowerCase()) } });
          }
        }
        await tx.auditEvent.create({
          data: {
            organizationId, actorUserId: caller.id, eventType: 'employee.imported', entityType: 'Organization', entityId: organizationId,
            metadata: { count: ready.length, withBank: ready.filter((r) => r.bank).length, withSalary: ready.filter((r) => r.basicSalary !== undefined).length, logins: giveLogin },
          },
        });
        return [...ids.entries()].filter(([n]) => ready.some((r) => r.employeeNumber.toLowerCase() === n)).map(([, id]) => id);
      },
      { timeout: 120_000 },
    );

    // Punches the machine already sent for these IDs now belong to them.
    const withMachine = await this.prisma.employee.findMany({ where: { id: { in: created }, machineUserId: { not: null } }, select: { id: true } });
    for (const e of withMachine) await this.punches.relink(organizationId, e.id).catch(() => undefined);

    // Logins: each person gets a welcome email to choose their own password.
    let logins = 0;
    const loginProblems: string[] = [];
    if (giveLogin) {
      for (const id of created) {
        try {
          await this.users.grantLoginAccess(organizationId, caller.id, id, { password: randomBytes(24).toString('base64url') });
          logins++;
        } catch (e) {
          const emp = await this.prisma.employee.findUnique({ where: { id }, select: { employeeNumber: true } });
          loginProblems.push(`${emp?.employeeNumber}: ${e instanceof Error ? e.message : 'login not created'}`);
        }
      }
    }
    this.log.log(`Imported ${created.length} employees for ${organizationId}`);
    return { imported: created.length, logins, loginProblems };
  }
}
