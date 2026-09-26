// Performance & KPIs.
//   HR (edits employees or company settings) runs the KPI list and review
//   cycles and can act on any review. A manager acts on the reviews of the
//   people who report to them. Everyone sees their own review.
//   Stages: GOALS (manager sets KPIs, targets, weights = 100)
//        → SELF (employee rates themselves; skipped if the company turns
//          self-reviews off) → MANAGER (final ratings) → DONE (score).

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, KpiMeasure, Prisma, ReviewCycleStatus, ReviewStage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { findActiveMembership } from '../common/membership';
import { findEmployeeForUser } from '../common/current-employee';
import { approverScope } from '../common/approver-scope';
import { startOfDayUtc } from '../common/dates';
import { attendanceRate, kpiScore, reviewScore, scoreBand } from './scoring';
import { CycleDto, KpiTemplateDto, LaunchCycleDto, RateDto, SetGoalsDto } from './performance.dto';

type Caller = { id: string; organizationId: string };
const HR_WIDE = ['hrm.employee.write', 'hrm.settings.write'];
const person = { select: { id: true, firstName: true, lastName: true, designation: true, employeeNumber: true, photoUpdatedAt: true } } as const;

@Injectable()
export class PerformanceService {
  constructor(
    private prisma: PrismaService,
    private rbac: RbacService,
  ) {}

  // Who is asking, and what they may do.
  private async who(caller: Caller) {
    if (!(await findActiveMembership(this.prisma, caller.id, caller.organizationId))) {
      throw new ForbiddenException("You don't have access to this company");
    }
    const permissions = await this.rbac.getEffectivePermissions(caller.id, caller.organizationId);
    const isHr = HR_WIDE.some((p) => permissions.has(p));
    const own = await findEmployeeForUser(this.prisma, caller.organizationId, caller.id);
    const scope = isHr ? null : await approverScope(this.prisma, caller.organizationId, { ...caller, permissions: [...permissions] });
    return { isHr, own, team: scope ?? [] };
  }

  private async requireHr(caller: Caller) {
    const w = await this.who(caller);
    if (!w.isHr) throw new ForbiddenException('Only HR can do this');
    return w;
  }

  private async settings(organizationId: string) {
    const s = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    return { scoring: s?.kpiScoring ?? 'BOTH', selfReview: s?.selfReviewEnabled ?? true };
  }

  private assertMeasureAllowed(scoring: string, measure: KpiMeasure) {
    if (scoring === 'RATING' && measure !== KpiMeasure.RATING) {
      throw new BadRequestException('Your company scores KPIs with 1–5 ratings only');
    }
    if (scoring === 'TARGET' && measure !== KpiMeasure.TARGET) {
      throw new BadRequestException('Your company scores KPIs against number targets only');
    }
  }

  // --- KPI list -----------------------------------------------------------

  async listKpis(caller: Caller) {
    await this.who(caller);
    return this.prisma.kpiTemplate.findMany({
      where: { organizationId: caller.organizationId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async createKpi(caller: Caller, dto: KpiTemplateDto) {
    await this.requireHr(caller);
    const { scoring } = await this.settings(caller.organizationId);
    const measure = dto.auto === 'ATTENDANCE' ? KpiMeasure.TARGET : dto.measure;
    this.assertMeasureAllowed(scoring, measure);
    return this.prisma.kpiTemplate.create({
      data: {
        organizationId: caller.organizationId,
        ...dto,
        measure,
        ...(dto.auto === 'ATTENDANCE' && { unit: '%', defaultTarget: dto.defaultTarget ?? 95, higherIsBetter: true }),
      },
    });
  }

  async updateKpi(caller: Caller, id: string, dto: Partial<KpiTemplateDto>) {
    await this.requireHr(caller);
    const existing = await this.prisma.kpiTemplate.findFirst({ where: { id, organizationId: caller.organizationId } });
    if (!existing) throw new NotFoundException('KPI not found');
    if (dto.measure) this.assertMeasureAllowed((await this.settings(caller.organizationId)).scoring, dto.measure);
    return this.prisma.kpiTemplate.update({ where: { id }, data: dto });
  }

  // --- Cycles ---------------------------------------------------------------

  async listCycles(caller: Caller) {
    await this.requireHr(caller);
    const cycles = await this.prisma.reviewCycle.findMany({
      where: { organizationId: caller.organizationId },
      orderBy: { periodStart: 'desc' },
      include: { reviews: { select: { stage: true, finalScore: true } } },
    });
    return cycles.map(({ reviews, ...c }) => ({ ...c, ...this.progress(reviews) }));
  }

  private progress(reviews: { stage: ReviewStage; finalScore: number | null }[]) {
    const done = reviews.filter((r) => r.stage === ReviewStage.DONE);
    const scores = done.map((r) => r.finalScore).filter((s): s is number => s !== null);
    return {
      reviewCount: reviews.length,
      doneCount: done.length,
      averageScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      byStage: Object.fromEntries(Object.values(ReviewStage).map((s) => [s, reviews.filter((r) => r.stage === s).length])),
    };
  }

  async createCycle(caller: Caller, dto: CycleDto) {
    await this.requireHr(caller);
    const periodStart = startOfDayUtc(new Date(dto.periodStart));
    const periodEnd = startOfDayUtc(new Date(dto.periodEnd));
    if (periodEnd < periodStart) throw new BadRequestException('The end date is before the start date');
    return this.prisma.reviewCycle.create({
      data: { organizationId: caller.organizationId, name: dto.name, periodStart, periodEnd },
    });
  }

  async getCycle(caller: Caller, id: string) {
    await this.requireHr(caller);
    const cycle = await this.findCycle(caller, id);
    const reviews = await this.prisma.performanceReview.findMany({
      where: { cycleId: id },
      orderBy: { employee: { firstName: 'asc' } },
      include: { employee: person },
    });
    const reviewerIds = [...new Set(reviews.map((r) => r.reviewerEmployeeId).filter((x): x is string => !!x))];
    const reviewers = await this.prisma.employee.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, firstName: true, lastName: true } });
    return {
      ...cycle,
      ...this.progress(reviews),
      reviews: reviews.map((r) => ({
        id: r.id,
        stage: r.stage,
        finalScore: r.finalScore,
        band: r.finalScore === null ? null : scoreBand(r.finalScore),
        employee: r.employee,
        reviewer: reviewers.find((x) => x.id === r.reviewerEmployeeId) ?? null,
      })),
    };
  }

  private async findCycle(caller: Caller, id: string) {
    const cycle = await this.prisma.reviewCycle.findFirst({ where: { id, organizationId: caller.organizationId } });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    return cycle;
  }

  // Creates a review (with KPIs from the chosen templates) for everyone in
  // scope who doesn't have one in this cycle yet. Can be run again later to
  // add new joiners.
  async launchCycle(caller: Caller, id: string, dto: LaunchCycleDto) {
    await this.requireHr(caller);
    const cycle = await this.findCycle(caller, id);
    if (cycle.status === ReviewCycleStatus.CLOSED) throw new BadRequestException('This cycle is closed');
    const templates = await this.prisma.kpiTemplate.findMany({
      where: { id: { in: dto.kpiTemplateIds }, organizationId: caller.organizationId, isActive: true },
    });
    if (templates.length !== dto.kpiTemplateIds.length) throw new BadRequestException('One or more KPIs were not found');
    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId: caller.organizationId,
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE] },
        ...(dto.employeeIds && { id: { in: dto.employeeIds } }),
        ...(dto.departmentId && { departmentId: dto.departmentId }),
        performanceReviews: { none: { cycleId: id } },
      },
      select: { id: true, managerId: true },
    });
    // Template weights are a starting point; spread them to total 100.
    const rawTotal = templates.reduce((s, t) => s + t.defaultWeight, 0);
    const weights = templates.map((t) => (rawTotal > 0 ? Math.round((t.defaultWeight / rawTotal) * 100) : 0));
    if (weights.length) weights[weights.length - 1] += 100 - weights.reduce((a, b) => a + b, 0);

    for (const e of employees) {
      await this.prisma.performanceReview.create({
        data: {
          organizationId: caller.organizationId,
          cycleId: id,
          employeeId: e.id,
          reviewerEmployeeId: e.managerId,
          kpis: {
            create: templates.map((t, i) => ({
              position: i,
              name: t.name,
              measure: t.measure,
              unit: t.unit,
              target: t.defaultTarget,
              weight: weights[i],
              higherIsBetter: t.higherIsBetter,
              auto: t.auto,
            })),
          },
        },
      });
    }
    await this.prisma.reviewCycle.update({ where: { id }, data: { status: ReviewCycleStatus.ACTIVE } });
    await this.audit(caller, 'performance.cycle_launched', id, { reviews: employees.length });
    return { created: employees.length };
  }

  async closeCycle(caller: Caller, id: string) {
    await this.requireHr(caller);
    await this.findCycle(caller, id);
    await this.prisma.reviewCycle.update({ where: { id }, data: { status: ReviewCycleStatus.CLOSED } });
    await this.audit(caller, 'performance.cycle_closed', id, {});
    return { closed: true };
  }

  async deleteCycle(caller: Caller, id: string) {
    await this.requireHr(caller);
    const cycle = await this.findCycle(caller, id);
    if (cycle.status !== ReviewCycleStatus.DRAFT) throw new BadRequestException('Only a cycle that hasn\'t started can be deleted');
    await this.prisma.reviewCycle.delete({ where: { id } });
    return { deleted: true };
  }

  // --- Reviews ----------------------------------------------------------------

  // mine = my own reviews; team = reviews I give (my reports, or all for HR
  // in active cycles).
  async listReviews(caller: Caller, scope: 'mine' | 'team') {
    const w = await this.who(caller);
    let where: Prisma.PerformanceReviewWhereInput;
    if (scope === 'mine') {
      if (!w.own) return [];
      where = { organizationId: caller.organizationId, employeeId: w.own.id };
    } else if (w.isHr) {
      where = { organizationId: caller.organizationId, cycle: { status: ReviewCycleStatus.ACTIVE } };
    } else {
      where = {
        organizationId: caller.organizationId,
        OR: [
          ...(w.own ? [{ reviewerEmployeeId: w.own.id }] : []),
          { employeeId: { in: w.team } },
        ],
        ...(w.own && { employeeId: { not: w.own.id } }),
      };
    }
    const reviews = await this.prisma.performanceReview.findMany({
      where,
      orderBy: [{ cycle: { periodStart: 'desc' } }, { employee: { firstName: 'asc' } }],
      include: { cycle: true, employee: person },
    });
    return reviews.map((r) => ({
      id: r.id,
      stage: r.stage,
      finalScore: r.finalScore,
      band: r.finalScore === null ? null : scoreBand(r.finalScore),
      acknowledgedAt: r.acknowledgedAt,
      cycle: { id: r.cycle.id, name: r.cycle.name, status: r.cycle.status, periodStart: r.cycle.periodStart, periodEnd: r.cycle.periodEnd },
      employee: r.employee,
    }));
  }

  private async loadReview(caller: Caller, id: string) {
    const review = await this.prisma.performanceReview.findFirst({
      where: { id, organizationId: caller.organizationId },
      include: { cycle: true, employee: person, kpis: { orderBy: { position: 'asc' } } },
    });
    if (!review) throw new NotFoundException('Review not found');
    const w = await this.who(caller);
    const isSelf = w.own?.id === review.employeeId;
    // Nobody manages their own review — their manager or HR does.
    const canManage =
      !isSelf && (w.isHr || (!!w.own && review.reviewerEmployeeId === w.own.id) || w.team.includes(review.employeeId));
    if (!isSelf && !canManage) throw new NotFoundException('Review not found');
    const open = review.cycle.status !== ReviewCycleStatus.CLOSED;
    return { review, isSelf, canManage, open };
  }

  async getReview(caller: Caller, id: string) {
    const { review, isSelf, canManage, open } = await this.loadReview(caller, id);
    const { scoring, selfReview } = await this.settings(caller.organizationId);
    const reviewer = review.reviewerEmployeeId
      ? await this.prisma.employee.findUnique({ where: { id: review.reviewerEmployeeId }, select: { id: true, firstName: true, lastName: true } })
      : null;
    // The employee sees the manager's ratings only once the review is done.
    const hideManager = isSelf && review.stage !== ReviewStage.DONE;
    const kpis = review.kpis.map((k) => ({
      ...k,
      managerRating: hideManager ? null : k.managerRating,
      managerNote: hideManager ? null : k.managerNote,
      score: kpiScore(k, review.stage !== ReviewStage.DONE && !hideManager),
    }));
    const preview = reviewScore(review.kpis, true);
    return {
      id: review.id,
      stage: review.stage,
      cycle: review.cycle,
      employee: review.employee,
      reviewer,
      selfComment: review.selfComment,
      managerComment: hideManager ? null : review.managerComment,
      finalScore: review.finalScore,
      band: review.finalScore === null ? null : scoreBand(review.finalScore),
      previewScore: hideManager ? null : preview.score,
      selfSubmittedAt: review.selfSubmittedAt,
      completedAt: review.completedAt,
      acknowledgedAt: review.acknowledgedAt,
      kpis,
      settings: { scoring, selfReview },
      can: {
        setGoals: open && canManage && review.stage === ReviewStage.GOALS,
        selfReview: open && isSelf && review.stage === ReviewStage.SELF,
        managerReview: open && canManage && (review.stage === ReviewStage.MANAGER || (review.stage === ReviewStage.SELF && !selfReview)),
        acknowledge: isSelf && review.stage === ReviewStage.DONE && !review.acknowledgedAt,
      },
    };
  }

  async setGoals(caller: Caller, id: string, dto: SetGoalsDto) {
    const { review, canManage, open } = await this.loadReview(caller, id);
    if (!open || !canManage || review.stage !== ReviewStage.GOALS) throw new ForbiddenException('Goals can only be set by the manager before they are shared');
    const { scoring } = await this.settings(caller.organizationId);
    const total = dto.kpis.reduce((s, k) => s + k.weight, 0);
    if (total !== 100) throw new BadRequestException(`Weights must add up to 100 (now ${total})`);
    for (const k of dto.kpis) {
      const measure = k.auto === 'ATTENDANCE' ? KpiMeasure.TARGET : k.measure;
      this.assertMeasureAllowed(scoring, measure);
      if (measure === KpiMeasure.TARGET && (k.target === undefined || k.target === null)) {
        throw new BadRequestException(`"${k.name}" needs a target`);
      }
    }
    await this.prisma.$transaction([
      this.prisma.reviewKpi.deleteMany({ where: { reviewId: id } }),
      this.prisma.reviewKpi.createMany({
        data: dto.kpis.map((k, i) => ({
          reviewId: id,
          position: i,
          name: k.name,
          measure: k.auto === 'ATTENDANCE' ? KpiMeasure.TARGET : k.measure,
          unit: k.auto === 'ATTENDANCE' ? '%' : k.unit,
          target: k.target ?? null,
          weight: k.weight,
          higherIsBetter: k.auto === 'ATTENDANCE' ? true : k.higherIsBetter ?? true,
          auto: k.auto ?? null,
        })),
      }),
    ]);
    return this.getReview(caller, id);
  }

  async shareGoals(caller: Caller, id: string) {
    const { review, canManage, open } = await this.loadReview(caller, id);
    if (!open || !canManage || review.stage !== ReviewStage.GOALS) throw new ForbiddenException('Only the manager can share goals');
    const total = review.kpis.reduce((s, k) => s + k.weight, 0);
    if (review.kpis.length === 0 || total !== 100) throw new BadRequestException('Add KPIs with weights adding up to 100 first');
    const { selfReview } = await this.settings(caller.organizationId);
    await this.prisma.performanceReview.update({
      where: { id },
      data: { stage: selfReview ? ReviewStage.SELF : ReviewStage.MANAGER },
    });
    await this.audit(caller, 'performance.goals_shared', id, { employeeId: review.employeeId });
    return this.getReview(caller, id);
  }

  async saveSelf(caller: Caller, id: string, dto: RateDto, submit: boolean) {
    const { review, isSelf, open } = await this.loadReview(caller, id);
    if (!open || !isSelf || review.stage !== ReviewStage.SELF) throw new ForbiddenException('Your self-review is not open');
    await this.applyInputs(review.kpis, dto, 'self');
    await this.prisma.performanceReview.update({ where: { id }, data: { selfComment: dto.comment ?? review.selfComment } });
    if (submit) {
      const kpis = await this.prisma.reviewKpi.findMany({ where: { reviewId: id } });
      const missing = kpis.filter((k) => k.measure === KpiMeasure.RATING && k.selfRating === null);
      if (missing.length) throw new BadRequestException(`Rate yourself on: ${missing.map((k) => k.name).join(', ')}`);
      await this.fillAuto(review);
      await this.prisma.performanceReview.update({ where: { id }, data: { stage: ReviewStage.MANAGER, selfSubmittedAt: new Date() } });
      await this.audit(caller, 'performance.self_submitted', id, {});
    }
    return this.getReview(caller, id);
  }

  async saveManager(caller: Caller, id: string, dto: RateDto, complete: boolean) {
    const { review, canManage, open } = await this.loadReview(caller, id);
    const { selfReview } = await this.settings(caller.organizationId);
    const inManagerStage = review.stage === ReviewStage.MANAGER || (review.stage === ReviewStage.SELF && !selfReview);
    if (!open || !canManage || !inManagerStage) throw new ForbiddenException('The manager review is not open');
    await this.applyInputs(review.kpis, dto, 'manager');
    await this.prisma.performanceReview.update({ where: { id }, data: { managerComment: dto.comment ?? review.managerComment } });
    if (complete) {
      await this.fillAuto(review);
      const kpis = await this.prisma.reviewKpi.findMany({ where: { reviewId: id } });
      const missing = kpis.filter((k) => (k.measure === KpiMeasure.RATING ? k.managerRating === null : k.actual === null));
      if (missing.length) throw new BadRequestException(`Still needs a rating or actual: ${missing.map((k) => k.name).join(', ')}`);
      const { score } = reviewScore(kpis);
      await this.prisma.performanceReview.update({
        where: { id },
        data: { stage: ReviewStage.DONE, finalScore: score, completedAt: new Date() },
      });
      await this.audit(caller, 'performance.review_completed', id, { employeeId: review.employeeId, score });
    }
    return this.getReview(caller, id);
  }

  async acknowledge(caller: Caller, id: string) {
    const { review, isSelf } = await this.loadReview(caller, id);
    if (!isSelf || review.stage !== ReviewStage.DONE) throw new ForbiddenException('Nothing to acknowledge');
    await this.prisma.performanceReview.update({ where: { id }, data: { acknowledgedAt: new Date() } });
    return this.getReview(caller, id);
  }

  // Ratings, actuals and notes for one side (self or manager). KPIs filled
  // automatically (attendance) can't be typed over.
  private async applyInputs(kpis: { id: string; measure: KpiMeasure; auto: string | null }[], dto: RateDto, side: 'self' | 'manager') {
    for (const input of dto.kpis) {
      const k = kpis.find((x) => x.id === input.id);
      if (!k) throw new BadRequestException('Unknown KPI');
      const data: Prisma.ReviewKpiUpdateInput = {};
      if (k.measure === KpiMeasure.RATING && input.rating !== undefined) data[side === 'self' ? 'selfRating' : 'managerRating'] = input.rating;
      if (k.measure === KpiMeasure.TARGET && !k.auto && input.actual !== undefined) data.actual = input.actual;
      if (input.note !== undefined) data[side === 'self' ? 'selfNote' : 'managerNote'] = input.note;
      if (Object.keys(data).length) await this.prisma.reviewKpi.update({ where: { id: k.id }, data });
    }
  }

  // Punctuality KPI = attendance rate over the cycle's dates.
  private async fillAuto(review: { employeeId: string; cycle: { periodStart: Date; periodEnd: Date }; kpis: { id: string; auto: string | null }[] }) {
    const autoKpis = review.kpis.filter((k) => k.auto === 'ATTENDANCE');
    if (!autoKpis.length) return;
    const records = await this.prisma.attendanceRecord.findMany({
      where: { employeeId: review.employeeId, date: { gte: review.cycle.periodStart, lte: review.cycle.periodEnd } },
      select: { status: true },
    });
    const rate = attendanceRate(records.map((r) => r.status));
    for (const k of autoKpis) await this.prisma.reviewKpi.update({ where: { id: k.id }, data: { actual: rate } });
  }

  private audit(caller: Caller, eventType: string, entityId: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.auditEvent.create({
      data: {
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        eventType,
        entityType: eventType.includes('cycle') ? 'ReviewCycle' : 'PerformanceReview',
        entityId,
        metadata,
      },
    });
  }
}
