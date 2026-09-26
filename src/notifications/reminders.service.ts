// Once a day: email about employee documents and training certificates that
// expire in the next 30 days — to the employee, and a summary to HR. Each
// reminder is sent once (ReminderLog), even if several servers run this.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EnrolmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Mailer } from '../auth/mailer';
import { appUrl } from '../auth/password-reset';
import { fmtDate } from './email-layout';
import { NotifyService } from './notify.service';

const DAY = 24 * 60 * 60 * 1000;
export const REMIND_DAYS = 30;

@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Reminders');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private prisma: PrismaService,
    private mailer: Mailer,
    private notify: NotifyService,
  ) {}

  onModuleInit() {
    if (process.env.REMINDERS_DISABLED === '1') return;
    const run = () => this.runAll().catch((e) => this.log.error(`Reminder run failed: ${e instanceof Error ? e.message : e}`));
    this.timers.push(setTimeout(run, 2 * 60 * 1000)); // shortly after start
    this.timers.push(setInterval(run, 6 * 60 * 60 * 1000)); // then every 6 hours; each reminder only once
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  // True the first time a key is claimed; false if it was already sent.
  private async claim(key: string) {
    try {
      await this.prisma.reminderLog.create({ data: { key } });
      return true;
    } catch (e: any) {
      if (e?.code === 'P2002') return false;
      throw e;
    }
  }

  async runAll(now = new Date()) {
    if (!this.mailer.enabled) return { organizations: 0 };
    const orgs = await this.prisma.organizationLocaleSettings.findMany({ where: { emailNotificationsEnabled: true }, select: { organizationId: true } });
    let reminders = 0;
    for (const o of orgs) reminders += await this.runFor(o.organizationId, now);
    return { organizations: orgs.length, reminders };
  }

  async runFor(organizationId: string, now = new Date()) {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const until = new Date(today.getTime() + REMIND_DAYS * DAY);
    const items: { employeeId: string; name: string; what: string; expires: Date }[] = [];

    const docs = await this.prisma.employeeDocument.findMany({
      where: { expiryDate: { gte: today, lte: until }, employee: { organizationId, status: { not: 'TERMINATED' } } },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    for (const d of docs) {
      if (!(await this.claim(`doc-${REMIND_DAYS}:${d.id}:${d.expiryDate!.toISOString().slice(0, 10)}`))) continue;
      items.push({ employeeId: d.employee.id, name: `${d.employee.firstName} ${d.employee.lastName}`, what: `${d.category} document`, expires: d.expiryDate! });
    }

    // Latest certificate per person + course, so a renewed one doesn't warn.
    const certs = await this.prisma.trainingEnrolment.findMany({
      where: { organizationId, status: EnrolmentStatus.COMPLETED, certificateExpiresAt: { not: null }, employee: { status: { not: 'TERMINATED' } } },
      include: { course: { select: { title: true } }, employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    const latest = new Map<string, (typeof certs)[number]>();
    for (const c of certs) {
      const k = `${c.employeeId}|${c.courseId}`;
      if (!latest.has(k) || latest.get(k)!.certificateExpiresAt! < c.certificateExpiresAt!) latest.set(k, c);
    }
    for (const c of latest.values()) {
      if (c.certificateExpiresAt! < today || c.certificateExpiresAt! > until) continue;
      if (!(await this.claim(`cert-${REMIND_DAYS}:${c.id}`))) continue;
      items.push({ employeeId: c.employee.id, name: `${c.employee.firstName} ${c.employee.lastName}`, what: `${c.course.title} certificate`, expires: c.certificateExpiresAt! });
    }
    if (!items.length) return 0;

    for (const i of items) {
      const me = await this.notify.loginOf(organizationId, i.employeeId);
      if (!me) continue;
      await this.notify.sendTo(organizationId, [me], (p) => ({
        subject: `Your ${i.what} expires on ${fmtDate(i.expires)}`,
        title: `Your ${i.what} expires soon`,
        lines: [`Hi ${p.firstName}, your ${i.what} expires on ${fmtDate(i.expires)}. Please arrange a renewal and give HR the new one.`],
        button: { label: 'Open Quscer People', url: appUrl() },
      }));
    }
    const hr = await this.notify.hrPeople(organizationId);
    await this.notify.sendTo(organizationId, hr, (p) => ({
      subject: `${items.length} document${items.length === 1 ? '' : 's'} or certificate${items.length === 1 ? '' : 's'} expiring soon`,
      title: 'Expiring in the next 30 days',
      lines: [`Hi ${p.firstName}, these expire soon:`, ...items.sort((a, b) => a.expires.getTime() - b.expires.getTime()).map((i) => `• ${i.name} — ${i.what}, ${fmtDate(i.expires)}`)],
      button: { label: 'Open Quscer People', url: appUrl() },
    }));
    return items.length;
  }
}
