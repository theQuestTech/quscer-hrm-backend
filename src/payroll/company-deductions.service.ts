import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CompanyDeduction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDeductionDto, UpdateCompanyDeductionDto } from './dto/company-deduction.dto';
import { Deduction, Slab, slabsProblem } from './company-deductions';

// Settings → Payroll deductions: the deductions a company sets up itself.
@Injectable()
export class CompanyDeductionsService {
  constructor(private prisma: PrismaService) {}

  async list(organizationId: string) {
    const [rows, builtIn] = await Promise.all([
      this.prisma.companyDeduction.findMany({ where: { organizationId }, orderBy: [{ countryCode: 'asc' }, { name: 'asc' }] }),
      // Countries Quscer has its own rules for, shown as "Built in".
      this.prisma.statutoryRule.findMany({
        where: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
        select: { countryCode: true, ruleType: true },
        distinct: ['countryCode', 'ruleType'],
      }),
    ]);
    const countries = new Map<string, string[]>();
    for (const r of builtIn) countries.set(r.countryCode, [...(countries.get(r.countryCode) ?? []), r.ruleType]);
    return {
      items: rows.map(toView),
      builtIn: [...countries].map(([countryCode, ruleTypes]) => ({ countryCode, ruleTypes: ruleTypes.sort() })),
    };
  }

  // The deductions a payroll run can use, as plain numbers.
  async forPayroll(organizationId: string): Promise<Deduction[]> {
    const rows = await this.prisma.companyDeduction.findMany({ where: { organizationId } });
    return rows.map((r) => ({ ...toView(r), effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo }));
  }

  async create(organizationId: string, actorUserId: string, dto: CreateCompanyDeductionDto) {
    const data = await this.clean(organizationId, dto);
    const row = await this.prisma.companyDeduction.create({ data: { organizationId, ...data } });
    await this.audit(organizationId, actorUserId, 'payroll.deduction_added', row);
    return toView(row);
  }

  async update(organizationId: string, actorUserId: string, id: string, dto: UpdateCompanyDeductionDto) {
    const current = await this.findOrThrow(organizationId, id);
    const view = toView(current);
    // Merge onto what's there, then check the whole thing again.
    const merged: CreateCompanyDeductionDto = {
      ...view,
      effectiveFrom: monthKey(current.effectiveFrom),
      effectiveTo: current.effectiveTo ? monthKey(current.effectiveTo) : null,
      ...stripUndefined(dto),
    };
    const data = await this.clean(organizationId, merged);
    const row = await this.prisma.companyDeduction.update({ where: { id }, data });
    await this.audit(organizationId, actorUserId, 'payroll.deduction_changed', row);
    return toView(row);
  }

  async remove(organizationId: string, actorUserId: string, id: string) {
    const row = await this.findOrThrow(organizationId, id);
    await this.prisma.companyDeduction.delete({ where: { id } });
    // Payslips already made keep their lines: they copy the name and amount.
    await this.audit(organizationId, actorUserId, 'payroll.deduction_removed', row);
    return { deleted: true };
  }

  private async findOrThrow(organizationId: string, id: string) {
    const row = await this.prisma.companyDeduction.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Deduction not found');
    return row;
  }

  // Checks the numbers each method needs and keeps only those, so a
  // deduction never carries leftovers from a method it used to have.
  private async clean(organizationId: string, dto: CreateCompanyDeductionDto) {
    const fail = (message: string) => {
      throw new BadRequestException(message);
    };
    const countryCode = dto.countryCode ?? null;
    const regionCode = dto.regionCode ?? null;
    if (regionCode && !countryCode) fail('Choose a country before a province / state');
    const currency = dto.currency ?? null;
    const positive = (n?: number | null) => (n ?? 0) > 0;

    const numbers = {
      employeePercent: null as number | null,
      employerPercent: null as number | null,
      employeeAmount: null as number | null,
      employerAmount: null as number | null,
      wageCap: null as number | null,
      slabs: Prisma.DbNull as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue,
    };
    let reducesTaxablePay = dto.reducesTaxablePay ?? false;
    switch (dto.method) {
      case 'PERCENT_OF_BASIC':
      case 'PERCENT_OF_GROSS':
        if (!positive(dto.employeePercent) && !positive(dto.employerPercent)) fail('Enter what the employee pays, what the company pays, or both');
        numbers.employeePercent = dto.employeePercent ?? 0;
        numbers.employerPercent = dto.employerPercent ?? 0;
        numbers.wageCap = dto.wageCap ?? null;
        if (numbers.wageCap !== null && !currency) fail('Choose the currency of the salary limit');
        break;
      case 'FIXED_AMOUNT':
        if (!positive(dto.employeeAmount) && !positive(dto.employerAmount)) fail('Enter what the employee pays, what the company pays, or both');
        if (!currency) fail('Choose the currency of the amounts');
        numbers.employeeAmount = dto.employeeAmount ?? 0;
        numbers.employerAmount = dto.employerAmount ?? 0;
        break;
      case 'TAX_SLABS': {
        const slabs = (dto.slabs ?? []).map((s) => ({ upTo: s.upTo ?? null, ratePercent: s.ratePercent }));
        const problem = slabsProblem(slabs);
        if (problem) fail(problem);
        if (!currency) fail('Choose the currency of the tax bands');
        numbers.slabs = slabs as unknown as Prisma.InputJsonValue;
        reducesTaxablePay = false; // it is the tax
        break;
      }
    }

    const appliesToAll = dto.appliesToAll ?? true;
    const employeeIds = appliesToAll ? [] : [...new Set(dto.employeeIds ?? [])];
    if (!appliesToAll) {
      if (!employeeIds.length) fail('Choose at least one person, or apply it to everyone');
      const found = await this.prisma.employee.count({ where: { organizationId, id: { in: employeeIds } } });
      if (found !== employeeIds.length) fail('Some of the chosen people are not in this company');
    }

    const effectiveFrom = monthStart(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? monthStart(dto.effectiveTo) : null;
    if (effectiveTo && effectiveTo < effectiveFrom) fail('The last month must be on or after the first month');

    return {
      name: dto.name.trim(),
      countryCode,
      regionCode,
      method: dto.method,
      ...numbers,
      currency: numbers.employeeAmount !== null || numbers.wageCap !== null || dto.method === 'TAX_SLABS' ? currency : null,
      appliesToAll,
      employeeIds,
      reducesTaxablePay,
      effectiveFrom,
      effectiveTo,
      sourceRef: dto.sourceRef?.trim() || null,
    };
  }

  private audit(organizationId: string, actorUserId: string, eventType: string, row: CompanyDeduction) {
    return this.prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId,
        eventType,
        entityType: 'CompanyDeduction',
        entityId: row.id,
        metadata: { name: row.name, countryCode: row.countryCode },
      },
    });
  }
}

const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));

function toView(r: CompanyDeduction) {
  return {
    id: r.id,
    name: r.name,
    countryCode: r.countryCode,
    regionCode: r.regionCode,
    method: r.method,
    employeePercent: num(r.employeePercent),
    employerPercent: num(r.employerPercent),
    employeeAmount: num(r.employeeAmount),
    employerAmount: num(r.employerAmount),
    wageCap: num(r.wageCap),
    slabs: (r.slabs as Slab[] | null) ?? null,
    currency: r.currency,
    appliesToAll: r.appliesToAll,
    employeeIds: r.employeeIds,
    reducesTaxablePay: r.reducesTaxablePay,
    effectiveFrom: monthKey(r.effectiveFrom),
    effectiveTo: r.effectiveTo ? monthKey(r.effectiveTo) : null,
    sourceRef: r.sourceRef,
  };
}

// "2026-01" ↔ 1 Jan 2026 (UTC)
function monthStart(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
