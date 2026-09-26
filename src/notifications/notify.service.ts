// Emails people when something needs them or concerns them:
//   leave requested → the approver (their manager, else HR)
//   leave decided   → the employee (first approval → the final approvers)
//   payroll approved → everyone paid: "your payslip is ready"
//   booked on training → the people booked
//   someone applied → HR and the job's hiring manager
//   login given     → a welcome email with a "choose your password" link
// Sending never blocks or fails the action that caused it, and a company can
// switch emails off in Settings.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Mailer } from '../auth/mailer';
import { PasswordResetService, appUrl } from '../auth/password-reset';
import { EmailContent, fmtDate, fmtDateTime, renderEmail } from './email-layout';

type Person = { email: string; firstName: string; userId?: string };
const HR_PERMISSIONS = ['hrm.settings.write', 'hrm.employee.write'];

@Injectable()
export class NotifyService {
  private readonly log = new Logger('Notify');

  constructor(
    private prisma: PrismaService,
    private mailer: Mailer,
    private passwordReset: PasswordResetService,
  ) {}

  // --- Plumbing ---------------------------------------------------------------

  private async enabled(organizationId: string) {
    if (!this.mailer.enabled) return null;
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, include: { localeSettings: true } });
    if (!org || org.localeSettings?.emailNotificationsEnabled === false) return null;
    return { name: org.name, timeZone: org.localeSettings?.defaultTimezone ?? 'Asia/Karachi' };
  }

  // Fire and forget: the caller never waits for, or fails because of, email.
  private later(task: () => Promise<unknown>) {
    setImmediate(() => task().catch((e) => this.log.error(`Notification failed: ${e instanceof Error ? e.message : e}`)));
  }

  async sendTo(organizationId: string, people: Person[], build: (p: Person) => EmailContent) {
    const org = await this.enabled(organizationId);
    if (!org) return 0;
    const seen = new Set<string>();
    let sent = 0;
    for (const p of people) {
      const key = p.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const email = renderEmail(build(p), org.name);
      if (await this.mailer.send({ to: p.email, ...email })) sent++;
    }
    return sent;
  }

  // Active logins in this company with HR rights.
  async hrPeople(organizationId: string, except?: string): Promise<Person[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        memberships: { some: { organizationId, isActive: true } },
        roleAssignments: {
          some: { organizationId, role: { permissions: { some: { permission: { key: { in: HR_PERMISSIONS } } } } } },
        },
        ...(except && { id: { not: except } }),
      },
      select: { id: true, email: true, firstName: true },
    });
    return users.map((u) => ({ email: u.email, firstName: u.firstName, userId: u.id }));
  }

  // The employee's own login, if they have one that still works here.
  async loginOf(organizationId: string, employeeId: string): Promise<Person | null> {
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId }, select: { userId: true } });
    if (!e?.userId) return null;
    const u = await this.prisma.user.findFirst({
      where: { id: e.userId, isActive: true, memberships: { some: { organizationId, isActive: true } } },
      select: { id: true, email: true, firstName: true },
    });
    return u ? { email: u.email, firstName: u.firstName, userId: u.id } : null;
  }

  // --- Leave ----------------------------------------------------------------------

  leaveRequested(organizationId: string, requestId: string) {
    this.later(async () => {
      const r = await this.prisma.leaveRequest.findFirst({
        where: { id: requestId, organizationId },
        include: { employee: { select: { id: true, firstName: true, lastName: true, managerId: true } }, leaveType: true },
      });
      if (!r) return;
      const manager = r.employee.managerId ? await this.loginOf(organizationId, r.employee.managerId) : null;
      const to = manager ? [manager] : await this.hrPeople(organizationId);
      const name = `${r.employee.firstName} ${r.employee.lastName}`;
      await this.sendTo(organizationId, to, (p) => ({
        subject: `${name} asked for ${r.leaveType.name.toLowerCase()} leave`,
        title: 'A leave request needs your decision',
        lines: [
          `Hi ${p.firstName}, ${name} asked for ${r.days} day${r.days === 1 ? '' : 's'} of ${r.leaveType.name.toLowerCase()} leave, ${fmtDate(r.startDate)}${r.days > 1 ? ` to ${fmtDate(r.endDate)}` : ''}.`,
          ...(r.reason ? [`Reason: ${r.reason}`] : []),
        ],
        button: { label: 'Review the request', url: `${appUrl()}/leave?tab=approvals` },
      }));
    });
  }

  leaveDecided(organizationId: string, requestId: string, outcome: 'FIRST_APPROVED' | 'APPROVED' | 'REJECTED', actorUserId: string) {
    this.later(async () => {
      const r = await this.prisma.leaveRequest.findFirst({
        where: { id: requestId, organizationId },
        include: { employee: { select: { id: true, firstName: true, lastName: true } }, leaveType: true },
      });
      if (!r) return;
      const when = `${fmtDate(r.startDate)}${r.days > 1 ? ` to ${fmtDate(r.endDate)}` : ''}`;
      if (outcome === 'FIRST_APPROVED') {
        const name = `${r.employee.firstName} ${r.employee.lastName}`;
        await this.sendTo(organizationId, await this.hrPeople(organizationId, actorUserId), (p) => ({
          subject: `Final approval needed: ${name}'s leave`,
          title: 'A leave request needs the final approval',
          lines: [`Hi ${p.firstName}, ${name}'s ${r.leaveType.name.toLowerCase()} leave (${when}) has its first approval and now needs a second person to approve it.`],
          button: { label: 'Review the request', url: `${appUrl()}/leave?tab=approvals` },
        }));
        return;
      }
      const me = await this.loginOf(organizationId, r.employee.id);
      if (!me) return;
      const approved = outcome === 'APPROVED';
      await this.sendTo(organizationId, [me], (p) => ({
        subject: approved ? 'Your leave was approved' : 'Your leave request was not approved',
        title: approved ? 'Your leave was approved ✓' : 'Your leave request was not approved',
        lines: [`Hi ${p.firstName}, your ${r.leaveType.name.toLowerCase()} leave for ${when} (${r.days} day${r.days === 1 ? '' : 's'}) was ${approved ? 'approved' : 'not approved'}.`],
        button: { label: 'See your leave', url: `${appUrl()}/leave` },
      }));
    });
  }

  // --- Payslips --------------------------------------------------------------------

  payslipsReady(organizationId: string, runId: string) {
    this.later(async () => {
      const run = await this.prisma.payrollRun.findFirst({ where: { id: runId, organizationId } });
      if (!run) return;
      const items = await this.prisma.payrollLineItem.findMany({ where: { payrollRunId: runId }, select: { employeeId: true } });
      const people: Person[] = [];
      for (const i of items) {
        const p = await this.loginOf(organizationId, i.employeeId);
        if (p) people.push(p);
      }
      const month = run.periodStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      await this.sendTo(organizationId, people, (p) => ({
        subject: `Your payslip for ${month} is ready`,
        title: `Your ${month} payslip is ready`,
        lines: [`Hi ${p.firstName}, your payslip for ${month} is ready to view and download.`, `For your privacy, amounts aren't included in this email.`],
        button: { label: 'Open my payslips', url: `${appUrl()}/payslips` },
      }));
    });
  }

  // --- Training ---------------------------------------------------------------------

  trainingBooked(organizationId: string, sessionId: string, employeeIds: string[]) {
    if (!employeeIds.length) return;
    this.later(async () => {
      const s = await this.prisma.trainingSession.findFirst({ where: { id: sessionId, organizationId }, include: { course: true } });
      const org = await this.enabled(organizationId);
      if (!s || !org) return;
      const people: Person[] = [];
      for (const id of employeeIds) {
        const p = await this.loginOf(organizationId, id);
        if (p) people.push(p);
      }
      await this.sendTo(organizationId, people, (p) => ({
        subject: `You're booked on ${s.course.title}`,
        title: `You're booked on ${s.course.title}`,
        lines: [
          `Hi ${p.firstName}, you've been booked on a training session.`,
          `When: ${fmtDateTime(s.startsAt, org.timeZone)}`,
          ...(s.location ? [`Where: ${s.location}`] : []),
          ...(s.trainer ? [`Trainer: ${s.trainer}`] : []),
        ],
        button: { label: 'See my training', url: `${appUrl()}/training` },
      }));
    });
  }

  // --- Recruitment -------------------------------------------------------------------

  candidateApplied(organizationId: string, applicationId: string) {
    this.later(async () => {
      const a = await this.prisma.jobApplication.findFirst({ where: { id: applicationId, organizationId }, include: { job: true } });
      if (!a) return;
      const to = await this.hrPeople(organizationId);
      if (a.job.hiringManagerEmployeeId) {
        const hm = await this.loginOf(organizationId, a.job.hiringManagerEmployeeId);
        if (hm) to.push(hm);
      }
      await this.sendTo(organizationId, to, (p) => ({
        subject: `New application: ${a.job.title}`,
        title: `${a.firstName} ${a.lastName} applied for ${a.job.title}`,
        lines: [`Hi ${p.firstName}, a new application came in through your careers page${a.city ? ` from ${a.city}` : ''}.`],
        button: { label: 'Open the candidate', url: `${appUrl()}/recruitment/candidates/${a.id}` },
      }));
    });
  }

  // --- Welcome -------------------------------------------------------------------------

  // A new login gets a link to choose their own password (valid 7 days), so
  // HR never has to share one. Someone who already had a login (another
  // company) is just told they've been added.
  welcome(organizationId: string, userId: string, isNewLogin: boolean) {
    this.later(async () => {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      const org = await this.enabled(organizationId);
      if (!user || !org) return;
      const link = isNewLogin ? await this.passwordReset.setPasswordLink(user.id, 7 * 24 * 60) : `${appUrl()}/login`;
      await this.sendTo(organizationId, [{ email: user.email, firstName: user.firstName }], (p) => ({
        subject: `Welcome to ${org.name} on Quscer People`,
        title: `Welcome to ${org.name}`,
        lines: isNewLogin
          ? [
              `Hi ${p.firstName}, ${org.name} has set you up on Quscer People — where you check in, ask for leave, see your payslips and more.`,
              `Choose your own password with the button below. The link works once and expires in 7 days. (If HR already gave you a starting password, that works too.)`,
              `Your sign-in email is ${user.email}.`,
            ]
          : [`Hi ${p.firstName}, you now also have access to ${org.name} on Quscer People. Sign in with your usual email and password, then switch to ${org.name} from the account menu.`],
        button: { label: isNewLogin ? 'Choose my password' : 'Sign in', url: link },
      }));
    });
  }
}
