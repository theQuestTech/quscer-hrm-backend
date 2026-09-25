// Data for the four dashboards. What each one gets:
//   employee   → GET /dashboard/me          (their own activity)
//   manager    → GET /dashboard/team        (their direct reports today)
//   HR         → GET /dashboard/summary     (the whole company today)
//   outsourced → GET /dashboard/companies   (one card per company they run)
// Personal numbers (leave balance, payslips, calendar) come from the
// existing endpoints the rest of the app already uses.

import { ForbiddenException, Injectable } from '@nestjs/common';
import { EmployeeStatus, LeaveRequestStatus, PayrollRunStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { findEmployeeForUser } from '../common/current-employee';
import { findActiveMembership } from '../common/membership';
import { approverScope } from '../common/approver-scope';
import { dayKey, todayInTimeZone } from '../common/dates';
import { activityKind, activityPhrase } from './activity';
import { countToday, todayStatus, TodayStatus } from './today-status';

type Caller = { id: string; organizationId: string; permissions?: string[] };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OPEN_LEAVE = [LeaveRequestStatus.PENDING, LeaveRequestStatus.FIRST_APPROVED];
const UPCOMING_DAYS = 30;
const HR_WIDE = ['hrm.employee.write', 'hrm.settings.write'];

const person = { select: { id: true, firstName: true, lastName: true, designation: true, employeeNumber: true } } as const;

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private rbac: RbacService,
  ) {}

  // --- HR: the whole company ----------------------------------------------

  async summary(caller: Caller) {
    const permissions = await this.rbac.getEffectivePermissions(caller.id, caller.organizationId);
    if (!HR_WIDE.some((p) => permissions.has(p))) {
      throw new ForbiddenException('The company overview is for HR');
    }
    const orgId = caller.organizationId;
    const today = await this.orgToday(orgId);
    const monthAgo = new Date(today.getTime() - 30 * MS_PER_DAY);
    const in30Days = new Date(today.getTime() + 30 * MS_PER_DAY);

    const [overview, activeMonthAgo, pendingCorrections, draftSettlements, expiringDocuments, latestPayrollRun, activity] =
      await Promise.all([
        this.overview(orgId, null, today),
        // Employees on the books 30 days ago, for the "vs. last month" change.
        this.prisma.employee.count({
          where: {
            organizationId: orgId,
            dateOfJoining: { lte: monthAgo },
            OR: [{ exitDate: null }, { exitDate: { gt: monthAgo } }],
            status: { not: EmployeeStatus.TERMINATED },
          },
        }),
        this.prisma.attendanceCorrection.count({ where: { organizationId: orgId, status: 'PENDING' } }),
        this.prisma.finalSettlement.count({ where: { organizationId: orgId, status: 'DRAFT' } }),
        this.prisma.employeeDocument.findMany({
          where: { employee: { organizationId: orgId }, expiryDate: { gte: today, lte: in30Days } },
          orderBy: { expiryDate: 'asc' },
          take: 10,
          include: { employee: { select: { id: true, firstName: true, lastName: true } } },
        }),
        this.prisma.payrollRun.findFirst({
          where: { organizationId: orgId },
          orderBy: { periodStart: 'desc' },
          include: { lineItems: { select: { netSalary: true, currency: true } } },
        }),
        this.companyActivity(orgId),
      ]);

    const activeEmployees = overview.counts.total;
    return {
      today,
      activeEmployees,
      activeEmployeesMonthAgo: activeMonthAgo,
      // Kept for older screens.
      presentToday: overview.counts.present,
      onLeaveToday: overview.counts.onLeave,
      pendingLeaveRequests: overview.pendingLeave,
      attendance: overview.counts,
      people: overview.people,
      upcomingLeave: overview.upcomingLeave,
      pendingApprovals: { leave: overview.pendingLeave, corrections: pendingCorrections, settlements: draftSettlements },
      expiringDocuments,
      latestPayrollRun: latestPayrollRun && {
        id: latestPayrollRun.id,
        periodStart: latestPayrollRun.periodStart,
        periodEnd: latestPayrollRun.periodEnd,
        payDate: latestPayrollRun.payDate,
        status: latestPayrollRun.status,
        employeeCount: latestPayrollRun.lineItems.length,
        totalNet: latestPayrollRun.lineItems.reduce((s, l) => s + Number(l.netSalary), 0),
        currency: latestPayrollRun.lineItems[0]?.currency ?? null,
      },
      activity,
    };
  }

  // --- Manager: their direct reports --------------------------------------

  async team(caller: Caller) {
    const permissions = await this.rbac.getEffectivePermissions(caller.id, caller.organizationId);
    const scope = await approverScope(this.prisma, caller.organizationId, { ...caller, permissions: [...permissions] });
    const orgId = caller.organizationId;
    const today = await this.orgToday(orgId);
    const ids = scope ?? [];
    const [overview, pendingCorrections] = await Promise.all([
      this.overview(orgId, ids, today),
      this.prisma.attendanceCorrection.count({ where: { organizationId: orgId, status: 'PENDING', employeeId: { in: ids } } }),
    ]);
    return {
      today,
      counts: overview.counts,
      people: overview.people,
      upcomingLeave: overview.upcomingLeave,
      pendingApprovals: { leave: overview.pendingLeave, corrections: pendingCorrections },
    };
  }

  // --- Employee: their own recent activity --------------------------------

  async me(caller: Caller) {
    if (!(await findActiveMembership(this.prisma, caller.id, caller.organizationId))) {
      throw new ForbiddenException("You don't have access to this company");
    }
    const orgId = caller.organizationId;
    const employee = await findEmployeeForUser(this.prisma, orgId, caller.id);
    if (!employee) return { activity: [], pendingRequests: { leave: 0, corrections: 0 } };
    const since = new Date(Date.now() - 45 * MS_PER_DAY);

    const [leave, attendance, payslips, documents, corrections, openLeave, openCorrections] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: {
          employeeId: employee.id,
          OR: [{ decidedAt: { gte: since } }, { firstApprovedAt: { gte: since } }, { createdAt: { gte: since } }],
        },
        include: { leaveType: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.attendanceRecord.findMany({
        where: { employeeId: employee.id, checkIn: { gte: since } },
        orderBy: { date: 'desc' },
        take: 3,
      }),
      this.prisma.payrollLineItem.findMany({
        where: {
          employeeId: employee.id,
          payrollRun: { status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.LOCKED] }, approvedAt: { gte: since } },
        },
        include: { payrollRun: true },
        take: 3,
      }),
      this.prisma.employeeDocument.findMany({
        where: { employeeId: employee.id, uploadedAt: { gte: since } },
        orderBy: { uploadedAt: 'desc' },
        take: 3,
      }),
      this.prisma.attendanceCorrection.findMany({
        where: { employeeId: employee.id, decidedAt: { gte: since } },
        orderBy: { decidedAt: 'desc' },
        take: 3,
      }),
      this.prisma.leaveRequest.count({ where: { employeeId: employee.id, status: { in: OPEN_LEAVE } } }),
      this.prisma.attendanceCorrection.count({ where: { employeeId: employee.id, status: 'PENDING' } }),
    ]);

    const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const items: { kind: string; text: string; at: Date }[] = [];
    for (const r of leave) {
      const what = `${r.leaveType.name} leave (${fmt(r.startDate)}${r.days > 1 ? ` – ${fmt(r.endDate)}` : ''})`;
      if (r.decidedAt && r.status === LeaveRequestStatus.APPROVED) items.push({ kind: 'approved', text: `Your ${what} was approved`, at: r.decidedAt });
      else if (r.decidedAt && r.status === LeaveRequestStatus.REJECTED) items.push({ kind: 'rejected', text: `Your ${what} was not approved`, at: r.decidedAt });
      else if (r.firstApprovedAt && r.status === LeaveRequestStatus.FIRST_APPROVED) items.push({ kind: 'leave', text: `Your ${what} got its first approval`, at: r.firstApprovedAt });
      else if (r.createdAt >= since) items.push({ kind: 'leave', text: `You requested ${what}`, at: r.createdAt });
    }
    for (const a of attendance) {
      if (a.checkOut) items.push({ kind: 'attendance', text: 'Timed out', at: a.checkOut });
      if (a.checkIn) items.push({ kind: 'attendance', text: 'Timed in', at: a.checkIn });
    }
    for (const p of payslips) {
      const month = p.payrollRun.periodStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      items.push({ kind: 'payroll', text: `Payslip for ${month} is available`, at: p.payrollRun.approvedAt ?? p.payrollRun.periodEnd });
    }
    for (const d of documents) items.push({ kind: 'document', text: `Document added: ${d.category}`, at: d.uploadedAt });
    for (const c of corrections) {
      items.push({
        kind: c.status === 'APPROVED' ? 'approved' : 'rejected',
        text: `Your time correction for ${fmt(c.date)} was ${c.status === 'APPROVED' ? 'approved' : 'not approved'}`,
        at: c.decidedAt!,
      });
    }
    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { activity: items.slice(0, 6), pendingRequests: { leave: openLeave, corrections: openCorrections } };
  }

  // --- Outsourced HR: every company they look after ------------------------

  async companies(callerId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: callerId, isActive: true, user: { isActive: true } },
      include: { organization: { select: { id: true, name: true } } },
    });
    const cards = [];
    for (const m of memberships) {
      const permissions = await this.rbac.getEffectivePermissions(callerId, m.organizationId);
      // Only companies where they can see the people, i.e. do HR work.
      if (!permissions.has('hrm.employee.read')) continue;
      const orgId = m.organizationId;
      const today = await this.orgToday(orgId);
      const [overview, corrections, latestPayrollRun] = await Promise.all([
        this.overview(orgId, null, today),
        this.prisma.attendanceCorrection.count({ where: { organizationId: orgId, status: 'PENDING' } }),
        this.prisma.payrollRun.findFirst({ where: { organizationId: orgId }, orderBy: { periodStart: 'desc' } }),
      ]);
      cards.push({
        id: orgId,
        name: m.organization.name,
        activeEmployees: overview.counts.total,
        presentToday: overview.counts.present,
        onLeaveToday: overview.counts.onLeave,
        attendanceRate: overview.counts.attendanceRate,
        pendingApprovals: overview.pendingLeave + corrections,
        latestPayrollRun: latestPayrollRun && {
          status: latestPayrollRun.status,
          periodStart: latestPayrollRun.periodStart,
        },
      });
    }
    return cards.sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- shared -----------------------------------------------------------

  // Today's picture for a set of employees (null = everyone active).
  private async overview(organizationId: string, employeeIds: string[] | null, today: Date) {
    const inScope = employeeIds ? { id: { in: employeeIds } } : {};
    const employees = await this.prisma.employee.findMany({
      where: { organizationId, status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE] }, ...inScope },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true, firstName: true, lastName: true, designation: true, employeeNumber: true, branchId: true,
        attendanceRecords: { where: { date: today }, select: { status: true, checkIn: true } },
      },
    });
    const ids = employees.map((e) => e.id);
    const horizon = new Date(today.getTime() + UPCOMING_DAYS * MS_PER_DAY);
    const [settings, holidays, leaveToday, upcoming, pendingLeave] = await Promise.all([
      this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } }),
      this.prisma.holiday.findMany({ where: { organizationId, date: today } }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: ids }, status: LeaveRequestStatus.APPROVED, startDate: { lte: today }, endDate: { gte: today } },
        select: { employeeId: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: ids },
          status: { in: [...OPEN_LEAVE, LeaveRequestStatus.APPROVED] },
          endDate: { gte: today },
          startDate: { lte: horizon },
        },
        orderBy: { startDate: 'asc' },
        take: 8,
        include: { leaveType: { select: { name: true } }, employee: person },
      }),
      this.prisma.leaveRequest.count({ where: { employeeId: { in: ids }, status: { in: OPEN_LEAVE } } }),
    ]);
    const weekend = (settings?.weekendDays ?? [0, 6]).includes(today.getUTCDay());
    const onLeave = new Set(leaveToday.map((l) => l.employeeId));
    const todayKey = dayKey(today);

    const people = employees.map(({ attendanceRecords, branchId, ...e }) => {
      const isHoliday = holidays.some((h) => dayKey(h.date) === todayKey && (!h.branchId || h.branchId === branchId));
      const status: TodayStatus = todayStatus({
        record: attendanceRecords[0] ?? null,
        onApprovedLeave: onLeave.has(e.id),
        isOffDay: weekend || isHoliday,
      });
      return { ...e, status, checkIn: attendanceRecords[0]?.checkIn ?? null };
    });

    return {
      counts: countToday(people.map((p) => p.status)),
      people,
      upcomingLeave: upcoming.map((l) => ({
        id: l.id,
        employee: l.employee,
        leaveType: l.leaveType.name,
        startDate: l.startDate,
        endDate: l.endDate,
        days: l.days,
        status: l.status,
      })),
      pendingLeave,
    };
  }

  // Latest audit events as sentences. The same person doing the same thing
  // several times in a row (e.g. marking a whole register) becomes one line
  // with a count.
  private async companyActivity(organizationId: string) {
    const events = await this.prisma.auditEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const lines: { kind: string; text: string; at: Date; key: string; count: number }[] = [];
    for (const e of events) {
      const key = `${e.actorUserId}|${e.eventType}`;
      const last = lines[lines.length - 1];
      if (last?.key === key) {
        last.count += 1;
        continue;
      }
      if (lines.length === 6) break;
      const actor = actors.find((a) => a.id === e.actorUserId);
      lines.push({
        kind: activityKind(e.eventType),
        text: `${actor ? `${actor.firstName} ${actor.lastName}` : 'Someone'} ${activityPhrase(e.eventType)}`,
        at: e.createdAt,
        key,
        count: 1,
      });
    }
    return lines.map(({ kind, text, at, count }) => ({
      kind,
      text: count > 1 ? `${text} (${count} times)` : text,
      at,
    }));
  }

  private async orgToday(organizationId: string) {
    const settings = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    return todayInTimeZone(settings?.defaultTimezone);
  }
}

