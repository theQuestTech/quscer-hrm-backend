import { attendanceRate, kpiScore, KpiForScore, reviewScore, scoreBand } from './scoring';

const rating = (managerRating: number | null, selfRating: number | null = null, weight = 50): KpiForScore => ({
  measure: 'RATING', weight, target: null, actual: null, higherIsBetter: true, selfRating, managerRating,
});
const target = (t: number | null, a: number | null, higherIsBetter = true, weight = 50): KpiForScore => ({
  measure: 'TARGET', weight, target: t, actual: a, higherIsBetter, selfRating: null, managerRating: null,
});

describe('kpiScore', () => {
  it('turns a 1–5 rating into a percentage', () => {
    expect(kpiScore(rating(4))).toBe(80);
    expect(kpiScore(rating(5))).toBe(100);
  });

  it('uses the self rating only as a preview', () => {
    expect(kpiScore(rating(null, 3))).toBeNull();
    expect(kpiScore(rating(null, 3), true)).toBe(60);
    expect(kpiScore(rating(2, 5), true)).toBe(40);
  });

  it('scores targets as actual ÷ target, capped at 120', () => {
    expect(kpiScore(target(20, 18))).toBe(90);
    expect(kpiScore(target(20, 40))).toBe(120);
    expect(kpiScore(target(20, null))).toBeNull();
  });

  it('flips the ratio when lower is better', () => {
    expect(kpiScore(target(5, 10, false))).toBe(50); // 10 complaints vs a target of 5
    expect(kpiScore(target(5, 0, false))).toBe(120);
  });
});

describe('reviewScore', () => {
  it('weights the KPI scores', () => {
    // 80 × 60% + 90 × 40% = 84
    expect(reviewScore([rating(4, null, 60), target(20, 18, true, 40)])).toEqual({ score: 84, complete: true });
  });

  it('is incomplete while a KPI has no score', () => {
    expect(reviewScore([rating(4, null, 60), target(20, null, true, 40)])).toEqual({ score: 80, complete: false });
    expect(reviewScore([])).toEqual({ score: null, complete: false });
  });
});

describe('scoreBand', () => {
  it('names the bands', () => {
    expect([95, 80, 65, 45, 10].map(scoreBand)).toEqual([
      'Outstanding', 'Exceeds expectations', 'Meets expectations', 'Needs improvement', 'Unsatisfactory',
    ]);
  });
});

describe('attendanceRate', () => {
  it('counts late and half days as came in', () => {
    expect(attendanceRate(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT'])).toBe(75);
    expect(attendanceRate(['ON_LEAVE'])).toBeNull();
  });
});
