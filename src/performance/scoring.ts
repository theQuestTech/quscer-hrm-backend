// Performance scores. Pure, so the rules can be unit-tested.
//
//   RATING KPI  → rating ÷ 5 × 100 (the manager's rating; the self rating
//                 is only a preview until the manager rates)
//   TARGET KPI  → actual ÷ target × 100, or target ÷ actual when lower is
//                 better (e.g. complaints), capped at 120 so one KPI can't
//                 swamp the rest
//   Review      → weighted average of the KPI scores (weights add up to 100)
//   Band        → 90+ Outstanding, 75+ Exceeds, 60+ Meets, 40+ Needs
//                 improvement, below 40 Unsatisfactory

export const TARGET_CAP = 120;

export interface KpiForScore {
  measure: 'RATING' | 'TARGET';
  weight: number;
  target: number | null;
  actual: number | null;
  higherIsBetter: boolean;
  selfRating: number | null;
  managerRating: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function kpiScore(k: KpiForScore, useSelfRating = false): number | null {
  if (k.measure === 'RATING') {
    const rating = k.managerRating ?? (useSelfRating ? k.selfRating : null);
    return rating === null ? null : round1((rating / 5) * 100);
  }
  if (k.target === null || k.actual === null) return null;
  let pct: number;
  if (k.higherIsBetter) pct = k.target === 0 ? (k.actual >= 0 ? 100 : 0) : (k.actual / k.target) * 100;
  else pct = k.actual <= 0 ? TARGET_CAP : (k.target / k.actual) * 100;
  return round1(Math.max(0, Math.min(pct, TARGET_CAP)));
}

// Weighted score over every KPI; `complete` is false while any KPI still
// has no score (the score shown is then over the scored ones only).
export function reviewScore(kpis: KpiForScore[], useSelfRating = false): { score: number | null; complete: boolean } {
  let total = 0;
  let weights = 0;
  let complete = kpis.length > 0;
  for (const k of kpis) {
    const s = kpiScore(k, useSelfRating);
    if (s === null) {
      complete = false;
      continue;
    }
    total += s * k.weight;
    weights += k.weight;
  }
  return { score: weights > 0 ? round1(total / weights) : null, complete };
}

export function scoreBand(score: number): string {
  if (score >= 90) return 'Outstanding';
  if (score >= 75) return 'Exceeds expectations';
  if (score >= 60) return 'Meets expectations';
  if (score >= 40) return 'Needs improvement';
  return 'Unsatisfactory';
}

// Punctuality KPI: share of marked days the person came in (present, late
// or half day) — the same rate the dashboards show.
export function attendanceRate(statuses: string[]): number | null {
  const came = statuses.filter((s) => s === 'PRESENT' || s === 'LATE' || s === 'HALF_DAY').length;
  const absent = statuses.filter((s) => s === 'ABSENT').length;
  return came + absent === 0 ? null : round1((came / (came + absent)) * 100);
}
