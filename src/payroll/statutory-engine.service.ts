// The statutory engine, for real. Everything upstream of this file (Employee,
// Branch, jurisdiction) exists to feed it a countryCode/regionCode/date;
// everything downstream (PayrollLineItem) exists to record what it decided.
// Pakistan's income tax/EOBI/social-security rules are NOT special-cased
// here — they're just StatutoryRule rows this reads generically. A second
// country needs new seed rows, not a new branch in this file — that promise
// is what this class either keeps or breaks.

import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StatutoryRuleType } from '@prisma/client';

export interface StatutoryDeductionResult {
  label: string;
  ruleId: string;
  employerAmount: number;
  employeeAmount: number; // this is what reduces the employee's net pay
}

@Injectable()
export class StatutoryEngineService {
  constructor(private prisma: PrismaService) {}

  // Finds the single rule that applies for a (country, region, type, date).
  // Region-specific rules win over national ones when both exist and match
  // — this is what lets Pakistan's four provincial social-security packs
  // coexist with a national EOBI rule under the same engine.
  private async findApplicableRule(
    ruleType: StatutoryRuleType,
    countryCode: string,
    regionCode: string | undefined,
    asOf: Date,
    skillTier?: string,
  ) {
    const candidates = await this.prisma.statutoryRule.findMany({
      where: {
        ruleType,
        countryCode,
        effectiveFrom: { lte: asOf },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] },
          ...(skillTier ? [{ OR: [{ skillTier }, { skillTier: null }] }] : []),
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    // Prefer an exact region match; fall back to a national (regionCode:
    // null) rule if no region-specific one exists.
    const regionMatch = candidates.find((r) => r.regionCode === regionCode);
    const nationalMatch = candidates.find((r) => r.regionCode === null);
    return regionMatch ?? nationalMatch ?? null;
  }

  // WBS 4.4a — income tax. Formula shape: { type: "slab", slabs: [{upTo, rate}],
  // surchargeThreshold?, surchargeRate? }. Annualizes, applies slabs
  // marginally, applies surcharge if above threshold, returns the MONTHLY
  // employee deduction (payroll periods are assumed monthly for now).
  async calculateIncomeTax(
    countryCode: string,
    regionCode: string | undefined,
    monthlyTaxableIncome: number,
    asOf: Date,
  ): Promise<StatutoryDeductionResult | null> {
    const rule = await this.findApplicableRule(
      StatutoryRuleType.INCOME_TAX, countryCode, regionCode, asOf,
    );
    if (!rule) return null;

    const formula = rule.formula as any;
    if (formula.type !== 'slab') {
      throw new BadRequestException(
        `StatutoryRule ${rule.id}: unsupported income tax formula type "${formula.type}"`,
      );
    }

    const annualIncome = formula.annualIncome
      ? monthlyTaxableIncome * 12
      : monthlyTaxableIncome;

    let tax = 0;
    let lowerBound = 0;
    for (const slab of formula.slabs) {
      const upTo = slab.upTo ?? Infinity;
      if (annualIncome > lowerBound) {
        const amountInSlab = Math.min(annualIncome, upTo) - lowerBound;
        tax += amountInSlab * slab.rate;
      }
      lowerBound = upTo;
      if (annualIncome <= upTo) break;
    }

    if (formula.surchargeThreshold && annualIncome > formula.surchargeThreshold) {
      tax += tax * formula.surchargeRate;
    }

    const monthlyTax = formula.annualIncome ? tax / 12 : tax;

    return {
      label: 'Income Tax',
      ruleId: rule.id,
      employerAmount: 0,
      employeeAmount: round2(monthlyTax),
    };
  }

  // WBS 4.5 — pension fund (EOBI-style). Formula shape:
  // { type: "flat_percent_of_min_wage", employerPct, employeePct, minEstablishmentSize? }.
  // Base is the MINIMUM WAGE for the employee's region/skill tier, not their
  // actual salary — this is Pakistan-specific behavior but expressed as data
  // (the formula says what to compute against), not hardcoded here.
  async calculatePensionFund(
    countryCode: string,
    regionCode: string | undefined,
    skillTier: string | undefined,
    asOf: Date,
  ): Promise<StatutoryDeductionResult | null> {
    const rule = await this.findApplicableRule(
      StatutoryRuleType.PENSION_FUND, countryCode, regionCode, asOf,
    );
    if (!rule) return null;

    const formula = rule.formula as any;
    if (formula.type !== 'flat_percent_of_min_wage') {
      throw new BadRequestException(
        `StatutoryRule ${rule.id}: unsupported pension fund formula type "${formula.type}"`,
      );
    }

    const minWageRule = await this.findApplicableRule(
      StatutoryRuleType.MINIMUM_WAGE, countryCode, regionCode, asOf, skillTier,
    );
    if (!minWageRule) {
      throw new BadRequestException(
        `No MINIMUM_WAGE rule found for ${countryCode}/${regionCode ?? 'national'} — ` +
        `PENSION_FUND rule ${rule.id} depends on it and cannot be calculated`,
      );
    }
    const minWage = (minWageRule.formula as any).amount;

    return {
      label: 'Pension Fund (EOBI)',
      ruleId: rule.id,
      employerAmount: round2(minWage * formula.employerPct),
      employeeAmount: round2(minWage * formula.employeePct),
    };
  }

  // WBS 4.5 — social security. Formula shape:
  // { type: "percent_of_wage", employerPct, wageCeiling, institution? }.
  // Employer-only contribution in Pakistan's provincial schemes (no
  // employee deduction), but the shape supports an employeePct if a future
  // country's scheme has one.
  async calculateSocialSecurity(
    countryCode: string,
    regionCode: string | undefined,
    grossWage: number,
    asOf: Date,
  ): Promise<StatutoryDeductionResult | null> {
    const rule = await this.findApplicableRule(
      StatutoryRuleType.SOCIAL_SECURITY, countryCode, regionCode, asOf,
    );
    if (!rule) return null;

    const formula = rule.formula as any;
    if (formula.type !== 'percent_of_wage') {
      throw new BadRequestException(
        `StatutoryRule ${rule.id}: unsupported social security formula type "${formula.type}"`,
      );
    }

    const wageBase = formula.wageCeiling
      ? Math.min(grossWage, formula.wageCeiling)
      : grossWage;

    return {
      label: `Social Security${formula.institution ? ` (${formula.institution})` : ''}`,
      ruleId: rule.id,
      employerAmount: round2(wageBase * formula.employerPct),
      employeeAmount: round2(wageBase * (formula.employeePct ?? 0)),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
