import { allocationForYear, AllocationInput, entitlementForYear } from './entitlement';

const annual = (dateOfJoining: string, year = 2026) =>
  entitlementForYear({
    accrual: 'ANNUAL',
    yearlyDays: 14,
    dateOfJoining: new Date(dateOfJoining),
    year,
    asOf: new Date('2026-06-15'),
  });

describe('entitlementForYear', () => {
  it('gives the full quota when employed all year', () => {
    expect(annual('2020-01-01')).toBe(14);
  });

  it('prorates the joining year, counting the joining month when joined by the 15th', () => {
    expect(annual('2026-03-10')).toBe(11.5); // Mar–Dec: 14 × 10/12 = 11.67 → 11.5
    expect(annual('2026-03-20')).toBe(10.5); // Apr–Dec: 14 × 9/12 = 10.5
  });

  it('is zero before joining', () => {
    expect(annual('2027-02-01')).toBe(0);
  });

  it('accrues monthly up to the as-of month', () => {
    const monthly = (asOf: string, dateOfJoining = '2020-01-01') =>
      entitlementForYear({ accrual: 'MONTHLY', yearlyDays: 12, dateOfJoining: new Date(dateOfJoining), year: 2026, asOf: new Date(asOf) });
    expect(monthly('2026-05-15')).toBe(5);
    expect(monthly('2027-01-10')).toBe(12);
    expect(monthly('2025-12-31')).toBe(0);
    expect(monthly('2026-05-15', '2026-04-02')).toBe(2); // Apr + May
  });
});

describe('allocationForYear', () => {
  const base: AllocationInput = {
    accrual: 'ANNUAL',
    yearlyDays: 14,
    maxCarryForwardDays: 0,
    dateOfJoining: new Date('2020-01-01'),
    asOf: new Date('2026-06-15'),
    rows: new Map(),
  };

  it('adds carried-forward days, capped', () => {
    const rows = new Map([[2025, { usedDays: 4, allocatedDays: 0, isManualAllocation: false }]]);
    // 2025: 14 + carry from 2024 (5, nothing used) = 19, used 4 → 15 left, capped at 5.
    expect(allocationForYear({ ...base, maxCarryForwardDays: 5, rows }, 2026)).toBe(19);
  });

  it('carries nothing when the cap is zero', () => {
    expect(allocationForYear(base, 2026)).toBe(14);
  });

  it('uses a manual allocation as-is', () => {
    const rows = new Map([[2026, { usedDays: 0, allocatedDays: 30, isManualAllocation: true }]]);
    expect(allocationForYear({ ...base, maxCarryForwardDays: 5, rows }, 2026)).toBe(30);
  });

  it('does not carry from before the joining year', () => {
    expect(allocationForYear({ ...base, maxCarryForwardDays: 5, dateOfJoining: new Date('2026-01-01') }, 2026)).toBe(14);
  });
});
