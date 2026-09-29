// The company's activity history (Settings → Activity history): every audit
// event, newest first, as a sentence with a link to what it was about. Read
// only — nothing here can change or remove an event.

import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { ACTIVITY_AREAS, ActivityArea, activityArea, activityPhrase, actorFallback } from '../dashboard/activity';

export interface ActivityFilter {
  area?: string;
  actor?: string; // a user id, or "support"
  from?: string; // YYYY-MM-DD, inclusive
  to?: string; // YYYY-MM-DD, inclusive
}

type Caller = { id: string; organizationId: string };
type Event = Prisma.AuditEventGetPayload<object>;
type Subject = { label: string; href: string | null };

const PAGE = 50;
const CSV_LIMIT = 10_000;
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const COUNTRY = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => {
  try {
    return COUNTRY.of(code) ?? code;
  } catch {
    return code;
  }
};

@Injectable()
export class ActivityService {
  constructor(
    private prisma: PrismaService,
    private rbac: RbacService,
  ) {}

  async list(caller: Caller, filter: ActivityFilter, cursor?: string) {
    await this.hrOnly(caller);
    const events = await this.prisma.auditEvent.findMany({
      where: this.where(caller.organizationId, filter),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    const page = events.slice(0, PAGE);
    return {
      items: await this.describe(caller.organizationId, page),
      nextCursor: events.length > PAGE ? page[page.length - 1].id : null,
    };
  }

  /** Checks the chained entries (the database trigger numbers and hashes each new
   *  one): a changed or deleted entry shows up as the first broken number. Normally only
   *  entries added since the last good check are read (from a saved checkpoint, whose
   *  own entry is re-checked too). The whole record is re-read when asked, when there's
   *  no checkpoint yet, and at least once a week. */
  async verify(caller: Caller, opts: { full?: boolean } = {}) {
    await this.hrOnly(caller);
    const org = caller.organizationId;
    const cp = await this.prisma.auditCheckpoint.findUnique({ where: { organizationId: org } });
    const full = !!opts.full || !cp || Date.now() - cp.fullCheckedAt.getTime() > FULL_CHECK_EVERY_MS;
    const from = full || !cp ? 0 : cp.seq;
    const [totals] = await this.prisma.$queryRaw<{ entries: bigint; last: number | null }[]>`
      SELECT count(*) AS entries, max("seq") AS last FROM "AuditEvent" WHERE "organizationId" = ${org} AND "seq" IS NOT NULL`;
    const entries = Number(totals?.entries ?? 0);
    // Numbers run 1, 2, 3… with no gaps, so a removed entry shows up as a count that
    // doesn't match the last number, wherever it was.
    if ((totals?.last ?? 0) !== entries) return { entries, intact: false, brokenAt: await this.firstGap(org), full };
    if (cp && !full) {
      const [anchor] = await this.prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT "hash" = ${cp.hash} AND "hash" = audit_event_hash("organizationId", "seq", "actorUserId", "eventType", "entityType", "entityId", "metadata"::jsonb, "createdAt", "prevHash") AS ok
        FROM "AuditEvent" WHERE "organizationId" = ${org} AND "seq" = ${cp.seq}`;
      if (!anchor?.ok) return { entries, intact: false, brokenAt: cp.seq, full };
    }
    // The checkpoint entry is read too (seq >= from) so the next one can be matched to it.
    const [r] = await this.prisma.$queryRaw<{ broken: number | null; last_seq: number | null; last_hash: string | null }[]>`
      WITH c AS (
        SELECT "seq", "hash", "prevHash",
               lag("hash") OVER (ORDER BY "seq") AS prev,
               lag("seq") OVER (ORDER BY "seq") AS prev_seq,
               audit_event_hash("organizationId", "seq", "actorUserId", "eventType", "entityType", "entityId", "metadata"::jsonb, "createdAt", "prevHash") AS recomputed
        FROM "AuditEvent" WHERE "organizationId" = ${org} AND "seq" IS NOT NULL AND "seq" >= ${from}
      )
      SELECT min("seq") FILTER (WHERE "seq" > ${from} AND ("hash" <> recomputed OR "prevHash" <> coalesce(prev, repeat('0', 64)) OR "seq" <> coalesce(prev_seq, 0) + 1)) AS broken,
             (SELECT "seq" FROM c ORDER BY "seq" DESC LIMIT 1) AS last_seq,
             (SELECT "hash" FROM c ORDER BY "seq" DESC LIMIT 1) AS last_hash
      FROM c`;
    if (r?.broken != null) return { entries, intact: false, brokenAt: r.broken, full };
    if (r?.last_seq && r.last_hash && (r.last_seq !== from || full)) {
      const now = new Date();
      await this.prisma.auditCheckpoint.upsert({
        where: { organizationId: org },
        create: { organizationId: org, seq: r.last_seq, hash: r.last_hash, fullCheckedAt: now },
        update: { seq: r.last_seq, hash: r.last_hash, checkedAt: now, ...(full ? { fullCheckedAt: now } : {}) },
      });
    }
    return { entries, intact: true, brokenAt: null, full, checked: Math.max((r?.last_seq ?? 0) - from, 0) };
  }

  private async firstGap(org: string) {
    const [g] = await this.prisma.$queryRaw<{ gap: number | null }[]>`
      SELECT min(s.n)::int AS gap FROM generate_series(1, (SELECT max("seq") FROM "AuditEvent" WHERE "organizationId" = ${org})) AS s(n)
      WHERE NOT EXISTS (SELECT 1 FROM "AuditEvent" WHERE "organizationId" = ${org} AND "seq" = s.n)`;
    return g?.gap ?? 1;
  }

  // Everyone who can appear as "who did it", for the filter.
  async people(caller: Caller) {
    await this.hrOnly(caller);
    const members = await this.prisma.membership.findMany({
      where: { organizationId: caller.organizationId },
      select: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    return members
      .map((m) => ({ id: m.user.id, name: `${m.user.firstName} ${m.user.lastName}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async csv(caller: Caller, filter: ActivityFilter): Promise<string> {
    await this.hrOnly(caller);
    const [events, settings] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where: this.where(caller.organizationId, filter),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: CSV_LIMIT,
      }),
      this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId: caller.organizationId } }),
    ]);
    const timeZone = settings?.defaultTimezone ?? 'Asia/Karachi';
    const when = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const rows = (await this.describe(caller.organizationId, events)).map((i) => [
      when.format(i.at).replace(',', ''),
      i.actor.name,
      i.text.replace('{subject}', i.subject?.label ?? 'someone'),
      i.text.includes('{subject}') ? '' : i.subject?.label ?? '',
      i.detail ?? '',
      i.area,
    ]);
    return [[`Date and time (${timeZone})`, 'Who', 'What', 'About', 'Details', 'Area'], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // --- helpers ------------------------------------------------------------------------

  private async hrOnly(caller: Caller) {
    const permissions = await this.rbac.getEffectivePermissions(caller.id, caller.organizationId);
    if (!permissions.has('hrm.settings.write')) throw new ForbiddenException('Only HR admins can see the activity history');
  }

  private where(organizationId: string, f: ActivityFilter): Prisma.AuditEventWhereInput {
    const and: Prisma.AuditEventWhereInput[] = [{ organizationId }];
    if (f.area) {
      const prefixes = ACTIVITY_AREAS[f.area as ActivityArea];
      if (!prefixes) throw new BadRequestException('Unknown area');
      and.push({ OR: prefixes.map((p) => ({ eventType: { startsWith: p } })) });
    }
    if (f.actor === 'support') and.push({ eventType: { startsWith: 'support.' } });
    else if (f.actor) and.push({ actorUserId: f.actor });
    const from = parseDay(f.from);
    const to = parseDay(f.to);
    if (from) and.push({ createdAt: { gte: from } });
    if (to) and.push({ createdAt: { lt: new Date(to.getTime() + 86_400_000) } });
    return { AND: and };
  }

  // Sentences, with who did it and what it was about — looked up in one go
  // per kind of thing, and only ever inside this company.
  private async describe(organizationId: string, events: Event[]) {
    const ids = (type: string) => [...new Set(events.filter((e) => e.entityType === type).map((e) => e.entityId))];
    const metaIds = (key: string) =>
      [...new Set(events.map((e) => (e.metadata as Record<string, unknown> | null)?.[key]).filter((v): v is string => typeof v === 'string'))];
    const userIds = [...new Set([...events.map((e) => e.actorUserId).filter((x): x is string => !!x), ...ids('User')])];

    const [users, runs, requests, records, corrections, balances, documents, settlements, devices, jobs, applications, courses, sessions, enrolments, trainingRequests, cycles, reviews, roles] =
      await Promise.all([
        this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }),
        this.prisma.payrollRun.findMany({ where: { organizationId, id: { in: ids('PayrollRun') } }, select: { id: true, periodStart: true } }),
        this.prisma.leaveRequest.findMany({
          where: { organizationId, id: { in: ids('LeaveRequest') } },
          select: { id: true, employeeId: true, startDate: true, endDate: true, days: true, leaveType: { select: { name: true } } },
        }),
        this.prisma.attendanceRecord.findMany({ where: { id: { in: ids('AttendanceRecord') }, employee: { organizationId } }, select: { id: true, employeeId: true } }),
        this.prisma.attendanceCorrection.findMany({ where: { id: { in: ids('AttendanceCorrection') }, employee: { organizationId } }, select: { id: true, employeeId: true, date: true } }),
        this.prisma.leaveBalance.findMany({
          where: { id: { in: ids('LeaveBalance') }, employee: { organizationId } },
          select: { id: true, employeeId: true, leaveType: { select: { name: true } } },
        }),
        this.prisma.employeeDocument.findMany({ where: { id: { in: ids('EmployeeDocument') }, employee: { organizationId } }, select: { id: true, employeeId: true } }),
        this.prisma.finalSettlement.findMany({ where: { organizationId, id: { in: ids('FinalSettlement') } }, select: { id: true, employeeId: true } }),
        this.prisma.attendanceDevice.findMany({ where: { organizationId, id: { in: ids('AttendanceDevice') } }, select: { id: true, name: true } }),
        this.prisma.jobOpening.findMany({ where: { organizationId, id: { in: ids('JobOpening') } }, select: { id: true, title: true } }),
        this.prisma.jobApplication.findMany({ where: { organizationId, id: { in: ids('JobApplication') } }, select: { id: true, firstName: true, lastName: true } }),
        this.prisma.trainingCourse.findMany({ where: { organizationId, id: { in: ids('TrainingCourse') } }, select: { id: true, title: true } }),
        this.prisma.trainingSession.findMany({ where: { id: { in: ids('TrainingSession') }, course: { organizationId } }, select: { id: true, course: { select: { title: true } } } }),
        this.prisma.trainingEnrolment.findMany({ where: { id: { in: ids('TrainingEnrolment') }, course: { organizationId } }, select: { id: true, employeeId: true } }),
        this.prisma.trainingRequest.findMany({ where: { id: { in: ids('TrainingRequest') }, employee: { organizationId } }, select: { id: true, employeeId: true } }),
        this.prisma.reviewCycle.findMany({ where: { organizationId, id: { in: ids('ReviewCycle') } }, select: { id: true, name: true } }),
        this.prisma.performanceReview.findMany({ where: { id: { in: ids('PerformanceReview') }, cycle: { organizationId } }, select: { id: true, employeeId: true } }),
        this.prisma.role.findMany({ where: { organizationId, id: { in: events.flatMap((e) => ((e.metadata as { roleIds?: unknown })?.roleIds as string[]) ?? []) } }, select: { id: true, name: true } }),
      ]);
    const employeeIds = [
      ...ids('Employee'),
      ...[requests, records, corrections, balances, documents, settlements, enrolments, trainingRequests, reviews].flat().map((x) => x.employeeId),
      ...metaIds('employeeId'),
    ];
    const employees = await this.prisma.employee.findMany({
      where: { organizationId, id: { in: [...new Set(employeeIds)] } },
      select: { id: true, firstName: true, lastName: true, userId: true },
    });
    // A user who is also an employee links to their profile.
    const employeeOfUser = new Map(employees.filter((e) => e.userId).map((e) => [e.userId!, e]));
    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
    const [userMap, empMap] = [byId(users), byId(employees)];
    const person = (employeeId?: string | null): Subject | null => {
      const e = employeeId ? empMap.get(employeeId) : undefined;
      return e ? { label: `${e.firstName} ${e.lastName}`, href: `/employees/${e.id}` } : null;
    };
    const maps = {
      run: byId(runs), request: byId(requests), record: byId(records), correction: byId(corrections), balance: byId(balances),
      document: byId(documents), settlement: byId(settlements), device: byId(devices), job: byId(jobs), app: byId(applications),
      course: byId(courses), session: byId(sessions), enrolment: byId(enrolments), trainingRequest: byId(trainingRequests),
      cycle: byId(cycles), review: byId(reviews), role: byId(roles),
    };

    return events.map((e) => {
      const meta = (e.metadata ?? {}) as Record<string, any>;
      let subject: Subject | null = null;
      let detail: string | null = null;
      switch (e.entityType) {
        case 'Employee':
          subject = person(e.entityId);
          break;
        case 'User': {
          const emp = employeeOfUser.get(e.entityId);
          const u = userMap.get(e.entityId);
          subject = emp ? person(emp.id) : u ? { label: `${u.firstName} ${u.lastName}`, href: null } : null;
          break;
        }
        case 'PayrollRun': {
          const r = maps.run.get(e.entityId);
          subject = r ? { label: `${MONTH.format(r.periodStart)} payroll`, href: `/payroll/${r.id}` } : null;
          break;
        }
        case 'LeaveRequest': {
          const r = maps.request.get(e.entityId);
          subject = person(r?.employeeId);
          if (r) detail = `${r.leaveType.name} leave, ${DAY.format(r.startDate)}${r.days > 1 ? `–${DAY.format(r.endDate)}` : ''} (${r.days} day${r.days === 1 ? '' : 's'})`;
          break;
        }
        case 'AttendanceRecord':
          subject = person(maps.record.get(e.entityId)?.employeeId ?? meta.employeeId);
          if (meta.status && meta.date) detail = `${String(meta.status).replace('_', ' ').toLowerCase()} on ${DAY.format(new Date(meta.date))}`;
          break;
        case 'AttendanceCorrection': {
          const c = maps.correction.get(e.entityId);
          subject = person(c?.employeeId);
          if (c) detail = `For ${DAY.format(c.date)}`;
          break;
        }
        case 'LeaveBalance': {
          const b = maps.balance.get(e.entityId);
          subject = person(b?.employeeId ?? meta.employeeId);
          if (b && meta.allocatedDays !== undefined) detail = `${b.leaveType.name} ${meta.year ?? ''}: ${meta.allocatedDays} days`.replace('  ', ' ');
          break;
        }
        case 'EmployeeDocument':
          subject = person(maps.document.get(e.entityId)?.employeeId);
          break;
        case 'FinalSettlement':
          subject = person(maps.settlement.get(e.entityId)?.employeeId ?? meta.employeeId);
          break;
        case 'AttendanceDevice': {
          // A linked machine ID is recorded against the employee.
          if (e.eventType === 'attendance.machine_id_linked') {
            subject = person(e.entityId);
            detail = meta.machineUserId ? `Machine ID ${meta.machineUserId}` : null;
          } else {
            const d = maps.device.get(e.entityId);
            subject = d ? { label: d.name, href: '/settings?tab=attendance' } : null;
            if (e.eventType === 'attendance.punches_imported' && meta.rows !== undefined) detail = `${meta.rows} rows, ${meta.saved ?? 0} punches saved`;
          }
          break;
        }
        case 'JobOpening': {
          const j = maps.job.get(e.entityId);
          subject = j ? { label: j.title, href: `/recruitment/jobs/${j.id}` } : meta.title ? { label: meta.title, href: null } : null;
          break;
        }
        case 'JobApplication': {
          const a = maps.app.get(e.entityId);
          subject = a ? { label: `${a.firstName} ${a.lastName}`, href: `/recruitment/candidates/${a.id}` } : meta.name ? { label: meta.name, href: null } : null;
          if (e.eventType === 'recruitment.stage_changed' && meta.to) detail = `Now: ${String(meta.to).toLowerCase()}${meta.reason ? ` — “${meta.reason}”` : ''}`;
          break;
        }
        case 'TrainingCourse':
          subject = maps.course.get(e.entityId) ? { label: maps.course.get(e.entityId)!.title, href: '/training' } : null;
          break;
        case 'TrainingSession':
          subject = maps.session.get(e.entityId) ? { label: maps.session.get(e.entityId)!.course.title, href: '/training' } : null;
          if (e.eventType === 'training.enrolled' && meta.count) detail = `${meta.count} ${meta.count === 1 ? 'person' : 'people'}`;
          break;
        case 'TrainingEnrolment':
          subject = person(maps.enrolment.get(e.entityId)?.employeeId ?? meta.employeeId);
          if (meta.course) detail = String(meta.course);
          break;
        case 'TrainingRequest':
          subject = person(maps.trainingRequest.get(e.entityId)?.employeeId);
          if (meta.title) detail = String(meta.title);
          break;
        case 'ReviewCycle':
          subject = maps.cycle.get(e.entityId) ? { label: maps.cycle.get(e.entityId)!.name, href: '/performance' } : null;
          break;
        case 'PerformanceReview':
          subject = person(maps.review.get(e.entityId)?.employeeId ?? meta.employeeId);
          break;
        case 'CompanyDeduction':
          // The name is kept in the event, so it still reads right after the deduction is removed.
          if (meta.name) subject = { label: String(meta.name), href: '/settings?tab=deductions' };
          if (meta.countryCode) detail = countryName(String(meta.countryCode));
          break;
      }
      if (e.eventType === 'user.roles_changed' || e.eventType === 'user.added') {
        const names = ((meta.roleIds as string[]) ?? []).map((id) => maps.role.get(id)?.name).filter(Boolean);
        if (names.length) detail = `${e.eventType === 'user.added' ? 'Roles' : 'Now'}: ${names.join(', ')}`;
      }
      if (e.eventType === 'user.updated' && typeof meta.isActive === 'boolean') detail = meta.isActive ? 'Access switched on' : 'Access switched off';
      if (e.eventType === 'employee.updated' && Array.isArray(meta.changedFields)) detail = `Changed: ${meta.changedFields.map(fieldName).join(', ')}`;
      if (e.eventType === 'attendance.checkin_blocked' && meta.reason) detail = String(meta.reason);
      if (e.eventType.startsWith('employee.bank_') && meta.newLast4) detail = `Account ****${meta.newLast4}${meta.oldLast4 ? ` (was ****${meta.oldLast4})` : ''}`;
      if (e.eventType === 'organization.two_step_for_all') detail = meta.on ? 'Everyone must use it' : 'Only people who handle pay, records or settings';
      if (e.eventType === 'user.signed_in' && meta.method) detail = `With ${meta.method}`;
      if (e.eventType === 'payroll.bank_file_exported' && meta.payments !== undefined) detail = `${meta.payments} payment${meta.payments === 1 ? '' : 's'}`;
      if (e.eventType.startsWith('support.')) {
        const parts = [meta.email && !subject ? `To ${meta.email}` : null, meta.reason ? `Reason: “${meta.reason}”` : null].filter(Boolean);
        detail = parts.length ? parts.join(' · ') : null;
      }
      const u = e.actorUserId ? userMap.get(e.actorUserId) : undefined;
      return {
        id: e.id,
        at: e.createdAt,
        area: activityArea(e.eventType),
        eventType: e.eventType,
        actor: { name: u ? `${u.firstName} ${u.lastName}` : actorFallback(e), isSupport: e.eventType.startsWith('support.') },
        text: activityPhrase(e.eventType),
        subject,
        detail,
      };
    });
  }
}

function parseDay(s?: string): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException('Dates look like 2026-10-01');
  return new Date(`${s}T00:00:00Z`);
}

// "dateOfJoining" → "date of joining".
function fieldName(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/Id$/, '').toLowerCase().trim();
}

// Quoted, and never starting with = + - @ so a spreadsheet can't run it.
function csvCell(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const FULL_CHECK_EVERY_MS = 7 * 86400000;
