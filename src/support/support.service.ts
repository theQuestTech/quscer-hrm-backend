// The support console: every company at a glance, one company in detail,
// and the fixes support can make. Everything support does is recorded twice:
// in SupportAction (the console's activity log) and in the company's own
// AuditEvent history.

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Mailer } from '../auth/mailer';
import { PasswordResetService, appUrl, resetEmail } from '../auth/password-reset';
import { NotifyService } from '../notifications/notify.service';
import { forgetOrgStatus } from '../common/org-status';
import type { SupportCaller } from './support-auth';

export const VIEW_MINUTES = 30;
const ONLINE_MINUTES = 10;
const EMAIL_PROBLEMS = ['FAILED', 'BOUNCED', 'COMPLAINED'] as const;
const DAY = 86_400_000;

@Injectable()
export class SupportService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService, // the customer-token signer (for "view as")
    private mailer: Mailer,
    private passwordReset: PasswordResetService,
    private notify: NotifyService,
  ) {}

  // --- At a glance -----------------------------------------------------------------------

  async overview() {
    const now = Date.now();
    const [companies, suspended, activeUsers, machinesOffline, emailProblems, openTickets] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { suspendedAt: { not: null } } }),
      this.prisma.user.count({ where: { isActive: true, lastSeenAt: { gte: new Date(now - 7 * DAY) } } }),
      this.prisma.attendanceDevice.count({
        where: { kind: 'ADMS', isActive: true, lastSeenAt: { not: null, lt: new Date(now - ONLINE_MINUTES * 60_000) } },
      }),
      this.prisma.emailLog.count({ where: { status: { in: [...EMAIL_PROBLEMS] }, createdAt: { gte: new Date(now - DAY) } } }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
    ]);
    return { companies, suspended, activeUsers, machinesOffline, emailProblems, openTickets, emailEnabled: this.mailer.enabled };
  }

  // Companies, newest first. `q` finds a company by its name or by the name
  // or email of anyone who can log in to it.
  async companies(q?: string) {
    const term = q?.trim();
    const orgs = await this.prisma.organization.findMany({
      where: term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              {
                memberships: {
                  some: {
                    user: {
                      OR: [
                        { email: { contains: term, mode: 'insensitive' } },
                        { firstName: { contains: term, mode: 'insensitive' } },
                        { lastName: { contains: term, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, name: true, createdAt: true, suspendedAt: true, localeSettings: { select: { emailNotificationsEnabled: true } } },
    });
    const ids = orgs.map((o) => o.id);
    if (!ids.length) return [];
    const now = Date.now();
    const [employees, logins, seen, owners, devices, emailProblems, tickets] = await Promise.all([
      this.prisma.employee.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids }, status: { not: 'TERMINATED' } }, _count: true }),
      this.prisma.membership.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids }, isActive: true, user: { isActive: true } }, _count: true }),
      this.prisma.$queryRaw<{ organizationId: string; lastSeenAt: Date | null }[]>`
        SELECT m."organizationId", MAX(u."lastSeenAt") AS "lastSeenAt"
        FROM "Membership" m JOIN "User" u ON u.id = m."userId"
        WHERE m."organizationId" IN (${Prisma.join(ids)}) AND m."isActive"
        GROUP BY m."organizationId"`,
      this.prisma.membership.findMany({
        where: { organizationId: { in: ids } },
        orderBy: { createdAt: 'asc' },
        distinct: ['organizationId'],
        select: { organizationId: true, user: { select: { email: true } } },
      }),
      this.prisma.attendanceDevice.findMany({
        where: { organizationId: { in: ids }, isActive: true, kind: 'ADMS' },
        select: { organizationId: true, lastSeenAt: true },
      }),
      this.prisma.emailLog.groupBy({
        by: ['organizationId'],
        where: { organizationId: { in: ids }, status: { in: [...EMAIL_PROBLEMS] }, createdAt: { gte: new Date(now - DAY) } },
        _count: true,
      }),
      this.prisma.supportTicket.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids }, status: { not: 'CLOSED' } }, _count: true }),
    ]);
    const count = (rows: { organizationId: string | null; _count: number }[]) => new Map(rows.map((r) => [r.organizationId, r._count]));
    const [emp, log, mail, help] = [count(employees), count(logins), count(emailProblems), count(tickets)];
    const lastSeen = new Map(seen.map((r) => [r.organizationId, r.lastSeenAt]));
    const owner = new Map(owners.map((o) => [o.organizationId, o.user.email]));
    return orgs.map((o) => {
      const machines = devices.filter((d) => d.organizationId === o.id);
      const online = machines.filter((d) => d.lastSeenAt && now - d.lastSeenAt.getTime() < ONLINE_MINUTES * 60_000).length;
      return {
        id: o.id,
        name: o.name,
        createdAt: o.createdAt,
        suspendedAt: o.suspendedAt,
        ownerEmail: owner.get(o.id) ?? null,
        employees: emp.get(o.id) ?? 0,
        logins: log.get(o.id) ?? 0,
        lastSeenAt: lastSeen.get(o.id) ?? null,
        machines: { total: machines.length, online, notConnected: machines.filter((d) => !d.lastSeenAt).length },
        emails: { on: o.localeSettings?.emailNotificationsEnabled !== false, problems24h: mail.get(o.id) ?? 0 },
        openTickets: help.get(o.id) ?? 0,
      };
    });
  }

  // --- One company ----------------------------------------------------------------------

  async company(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id }, include: { localeSettings: true } });
    if (!org) throw new NotFoundException('Company not found');
    const since = new Date(Date.now() - 7 * DAY);
    const [employees, members, devices, emails, payrollRuns, branches, tickets, actions] = await Promise.all([
      this.prisma.employee.count({ where: { organizationId: id, status: { not: 'TERMINATED' } } }),
      this.prisma.membership.findMany({
        where: { organizationId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          isActive: true,
          createdAt: true,
          user: {
            select: {
              id: true, email: true, firstName: true, lastName: true, isActive: true, lastSeenAt: true, passwordHash: true,
              roleAssignments: { where: { organizationId: id }, select: { role: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.attendanceDevice.findMany({
        where: { organizationId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, kind: true, serialNumber: true, isActive: true, lastSeenAt: true, lastPunchAt: true },
      }),
      this.prisma.emailLog.findMany({
        where: { organizationId: id, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, to: true, kind: true, subject: true, status: true, error: true, createdAt: true },
      }),
      this.prisma.payrollRun.count({ where: { organizationId: id } }),
      this.prisma.branch.count({ where: { organizationId: id } }),
      this.prisma.supportTicket.findMany({
        where: { organizationId: id },
        orderBy: { lastMessageAt: 'desc' },
        take: 20,
        select: { id: true, subject: true, status: true, lastMessageAt: true, user: { select: { firstName: true, lastName: true } } },
      }),
      this.activity({ organizationId: id, take: 30 }),
    ]);
    const s = org.localeSettings;
    return {
      id: org.id,
      name: org.name,
      createdAt: org.createdAt,
      suspendedAt: org.suspendedAt,
      suspendedReason: org.suspendedReason,
      timezone: s?.defaultTimezone ?? 'Asia/Karachi',
      employees,
      branches,
      payrollRuns,
      setup: {
        emailNotifications: s?.emailNotificationsEnabled !== false,
        checkInMethod: s?.defaultCheckInMethod ?? 'BOTH',
        officeNetworkRequired: !!s?.defaultRequireOfficeNetwork,
        officeLocationRequired: !!s?.defaultRequireOfficeLocation,
        modules: s?.enabledModules ?? [],
      },
      logins: members.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        roles: m.user.roleAssignments.map((r) => r.role.name),
        lastSeenAt: m.user.lastSeenAt,
        hasPassword: !!m.user.passwordHash,
        canLogIn: m.isActive && m.user.isActive,
      })),
      machines: devices,
      emails,
      tickets,
      actions,
    };
  }

  // --- Fixes ----------------------------------------------------------------------------

  async suspend(agent: SupportCaller, organizationId: string, reason: string) {
    const org = await this.org(organizationId);
    if (org.suspendedAt) throw new BadRequestException('This company is already switched off');
    await this.prisma.organization.update({ where: { id: organizationId }, data: { suspendedAt: new Date(), suspendedReason: reason } });
    forgetOrgStatus(organizationId);
    await this.record(agent, 'company.suspended', organizationId, null, { reason });
    return { ok: true };
  }

  async resume(agent: SupportCaller, organizationId: string) {
    const org = await this.org(organizationId);
    if (!org.suspendedAt) throw new BadRequestException('This company is already on');
    await this.prisma.organization.update({ where: { id: organizationId }, data: { suspendedAt: null, suspendedReason: null } });
    forgetOrgStatus(organizationId);
    await this.record(agent, 'company.resumed', organizationId, null, {});
    return { ok: true };
  }

  // Emails the person a one-hour "choose a new password" link. Support never
  // sees or sets anyone's password.
  async sendResetLink(agent: SupportCaller, organizationId: string, userId: string) {
    const user = await this.member(organizationId, userId);
    if (!this.mailer.enabled) throw new BadRequestException('Email is not set up on the server (RESEND_API_KEY)');
    const link = await this.passwordReset.setPasswordLink(user.id, 60);
    const sent = await this.mailer.send({ to: user.email, ...resetEmail(user.firstName, link) }, { organizationId, kind: 'password_reset' });
    await this.record(agent, 'user.reset_link_sent', organizationId, userId, { email: user.email, sent });
    if (!sent) throw new BadRequestException("The email service didn't accept the email — see Emails below for the reason");
    return { ok: true };
  }

  async resendWelcome(agent: SupportCaller, organizationId: string, userId: string) {
    const user = await this.member(organizationId, userId);
    if (!this.mailer.enabled) throw new BadRequestException('Email is not set up on the server (RESEND_API_KEY)');
    const sent = await this.notify.welcomeNow(organizationId, userId, true, true);
    await this.record(agent, 'user.welcome_resent', organizationId, userId, { email: user.email, sent });
    if (!sent) throw new BadRequestException("The email couldn't be sent — see Emails below for the reason");
    return { ok: true };
  }

  // A read-only look at HRM as this person, for VIEW_MINUTES.
  async viewAs(agent: SupportCaller, organizationId: string, userId: string, reason: string) {
    const org = await this.org(organizationId);
    if (org.suspendedAt) throw new BadRequestException('Switch the company back on to view it');
    const user = await this.member(organizationId, userId);
    const expiresAt = new Date(Date.now() + VIEW_MINUTES * 60_000);
    const session = await this.prisma.supportViewSession.create({
      data: { agentId: agent.agentId, userId, organizationId, reason, expiresAt },
    });
    const token = await this.jwt.signAsync(
      { id: user.id, organizationId, email: user.email, view: { sessionId: session.id, agentId: agent.agentId } },
      { expiresIn: `${VIEW_MINUTES}m` },
    );
    await this.record(agent, 'user.viewed', organizationId, userId, { email: user.email, reason, sessionId: session.id });
    return { token, expiresAt, url: `${appUrl()}/support-view` };
  }

  async endView(agent: SupportCaller, sessionId: string) {
    await this.prisma.supportViewSession.updateMany({ where: { id: sessionId, agentId: agent.agentId, endedAt: null }, data: { endedAt: new Date() } });
    return { ok: true };
  }

  // --- Activity log -----------------------------------------------------------------------

  async activity(filter: { organizationId?: string; take?: number } = {}) {
    const rows = await this.prisma.supportAction.findMany({
      where: filter.organizationId ? { organizationId: filter.organizationId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: filter.take ?? 200,
      include: { agent: { select: { name: true } }, organization: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      agentName: r.agent.name,
      organization: r.organization,
      userId: r.userId,
      detail: r.detail,
      createdAt: r.createdAt,
    }));
  }

  // --- Helpers ------------------------------------------------------------------------------

  private async org(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Company not found');
    return org;
  }

  // Someone who can currently log in to this company.
  private async member(organizationId: string, userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId, userId, isActive: true, user: { isActive: true } },
      include: { user: true },
    });
    if (!membership) throw new NotFoundException("This person can't log in to this company");
    return membership.user;
  }

  private async record(agent: SupportCaller, action: string, organizationId: string, userId: string | null, detail: Prisma.InputJsonObject) {
    await this.prisma.supportAction.create({ data: { agentId: agent.agentId, action, organizationId, userId, detail } });
    await this.prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId: null,
        eventType: `support.${action}`,
        entityType: userId ? 'User' : 'Organization',
        entityId: userId ?? organizationId,
        metadata: { ...detail, supportAgent: agent.name },
      },
    });
  }
}

