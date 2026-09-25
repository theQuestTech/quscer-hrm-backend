import { StatutoryEngineService } from './statutory-engine.service';

// A fake Prisma that returns the given rules for any findMany — enough to
// test the engine's arithmetic and rule selection without a database.
function engineWithRules(rules: any[]) {
  const prisma: any = {
    statutoryRule: {
      findMany: async ({ where }: any) => rules.filter((r) => r.ruleType === where.ruleType),
    },
  };
  return new StatutoryEngineService(prisma);
}

const asOf = new Date('2026-10-01');

const taxRule = {
  id: 'tax',
  ruleType: 'INCOME_TAX',
  regionCode: null,
  effectiveFrom: new Date('2025-07-01'),
  formula: {
    type: 'slab',
    annualIncome: true,
    slabs: [
      { upTo: 600000, rate: 0 },
      { upTo: 1200000, rate: 0.05 },
      { upTo: null, rate: 0.15 },
    ],
  },
};

describe('StatutoryEngineService', () => {
  it('charges no tax below the first slab', async () => {
    const result = await engineWithRules([taxRule]).calculateIncomeTax('PK', 'PB', 50000, asOf);
    expect(result!.employeeAmount).toBe(0);
  });

  it('applies slabs marginally on annualised income and returns the monthly amount', async () => {
    // 150,000/month = 1,800,000/year:
    //   600,000 × 0% + 600,000 × 5% + 600,000 × 15% = 120,000/year = 10,000/month
    const result = await engineWithRules([taxRule]).calculateIncomeTax('PK', 'PB', 150000, asOf);
    expect(result!.employeeAmount).toBe(10000);
    expect(result!.ruleId).toBe('tax');
  });

  it('adds a surcharge above the threshold', async () => {
    const rule = { ...taxRule, formula: { ...taxRule.formula, surchargeThreshold: 1000000, surchargeRate: 0.1 } };
    const result = await engineWithRules([rule]).calculateIncomeTax('PK', 'PB', 150000, asOf);
    expect(result!.employeeAmount).toBe(11000);
  });

  it('returns null when no rule applies', async () => {
    expect(await engineWithRules([]).calculateIncomeTax('PK', 'PB', 150000, asOf)).toBeNull();
  });

  it('prefers the region-specific social security rule over a national one', async () => {
    const rules = [
      { id: 'national', ruleType: 'SOCIAL_SECURITY', regionCode: null, formula: { type: 'percent_of_wage', employerPct: 0.01 } },
      { id: 'punjab', ruleType: 'SOCIAL_SECURITY', regionCode: 'PB', formula: { type: 'percent_of_wage', employerPct: 0.06, wageCeiling: 25000 } },
    ];
    const result = await engineWithRules(rules).calculateSocialSecurity('PK', 'PB', 150000, asOf);
    expect(result!.ruleId).toBe('punjab');
    // Current behaviour: the wage base is capped at the ceiling (25,000 × 6%).
    expect(result!.employerAmount).toBe(1500);
    expect(result!.employeeAmount).toBe(0);
  });

  it('bases EOBI on the minimum wage, not the salary', async () => {
    const rules = [
      { id: 'eobi', ruleType: 'PENSION_FUND', regionCode: null, formula: { type: 'flat_percent_of_min_wage', employerPct: 0.05, employeePct: 0.01 } },
      { id: 'minwage', ruleType: 'MINIMUM_WAGE', regionCode: 'PB', formula: { type: 'flat_amount', amount: 40000 } },
    ];
    const result = await engineWithRules(rules).calculatePensionFund('PK', 'PB', undefined, asOf);
    expect(result!.employeeAmount).toBe(400);
    expect(result!.employerAmount).toBe(2000);
  });
});
