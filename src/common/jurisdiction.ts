// Where an employee's tax and contributions are worked out: their own
// country and province/state when set, otherwise their branch's. HR usually
// sets it once per branch; an employee's own value is for someone who
// lives or is registered somewhere else.

type WithBranch = {
  countryCode: string | null;
  regionCode: string | null;
  branch?: { countryCode: string; regionCode: string | null } | null;
};

export function jurisdictionOf(e: WithBranch): { countryCode: string | null; regionCode: string | null } {
  // A region only makes sense with its own country, so take both from the
  // same place.
  if (e.countryCode) return { countryCode: e.countryCode, regionCode: e.regionCode ?? (e.branch && e.branch.countryCode === e.countryCode ? e.branch.regionCode : null) };
  if (e.branch) return { countryCode: e.branch.countryCode, regionCode: e.branch.regionCode };
  return { countryCode: null, regionCode: null };
}

export const BRANCH_JURISDICTION = { select: { countryCode: true, regionCode: true } } as const;
