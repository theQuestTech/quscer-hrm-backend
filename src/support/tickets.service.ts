// Help requests: a customer asks from "Get help" in HRM, Quscer support
// answers from the console. Each side is emailed when the other writes.
//   OPEN      → waiting for Quscer
//   ANSWERED  → waiting for the customer
//   CLOSED    → done (a new message from the customer reopens it)

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { SupportTicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Mailer } from '../auth/mailer';
import { appUrl } from '../auth/password-reset';
import { renderEmail } from '../notifications/email-layout';
import type { RequestUser } from '../auth/jwt-auth.guard';
import type { SupportCaller } from './support-auth';

const MESSAGE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  agent: { select: { name: true } },
  user: { select: { firstName: true, lastName: true } },
} as const;

// Email bodies show at most this much of a message.
const EMAIL_CHARS = 2000;

@Injectable()
export class TicketsService {
  private readonly log = new Logger('Tickets');

  constructor(
    private prisma: PrismaService,
    private mailer: Mailer,
  ) {}

  // --- Customers ----------------------------------------------------------------------

  async mine(caller: RequestUser) {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { userId: caller.id, organizationId: caller.organizationId },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1, select: MESSAGE_SELECT } },
    });
    return tickets.map(({ messages, ...t }) => ({ ...t, lastMessage: messages[0] ? this.message(messages[0]) : null }));
  }

  async mineOne(caller: RequestUser, id: string) {
    const t = await this.prisma.supportTicket.findFirst({
      where: { id, userId: caller.id, organizationId: caller.organizationId },
      include: { messages: { orderBy: { createdAt: 'asc' }, select: MESSAGE_SELECT } },
    });
    if (!t) throw new NotFoundException('Help request not found');
    return { ...t, messages: t.messages.map((m) => this.message(m)) };
  }

  async create(caller: RequestUser, subject: string, body: string, page?: string) {
    const t = await this.prisma.supportTicket.create({
      data: {
        organizationId: caller.organizationId,
        userId: caller.id,
        subject,
        page: page || null,
        messages: { create: { body, userId: caller.id } },
      },
    });
    this.tellSupport(t.id, true);
    return { id: t.id };
  }

  async customerReply(caller: RequestUser, id: string, body: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, userId: caller.id, organizationId: caller.organizationId } });
    if (!t) throw new NotFoundException('Help request not found');
    await this.prisma.supportTicket.update({
      where: { id },
      data: { status: 'OPEN', lastMessageAt: new Date(), messages: { create: { body, userId: caller.id } } },
    });
    this.tellSupport(id, false);
    return { ok: true };
  }

  async customerClose(caller: RequestUser, id: string) {
    const r = await this.prisma.supportTicket.updateMany({
      where: { id, userId: caller.id, organizationId: caller.organizationId },
      data: { status: 'CLOSED' },
    });
    if (!r.count) throw new NotFoundException('Help request not found');
    return { ok: true };
  }

  // --- Support console -----------------------------------------------------------------

  async list(filter: { status?: string; organizationId?: string }) {
    const status = ['OPEN', 'ANSWERED', 'CLOSED'].includes(filter.status ?? '') ? (filter.status as SupportTicketStatus) : undefined;
    const tickets = await this.prisma.supportTicket.findMany({
      where: { ...(status && { status }), ...(filter.organizationId && { organizationId: filter.organizationId }) },
      // Waiting longest first when looking at open ones; newest first otherwise.
      orderBy: { lastMessageAt: status === 'OPEN' ? 'asc' : 'desc' },
      take: 200,
      include: {
        organization: { select: { id: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: MESSAGE_SELECT },
      },
    });
    return tickets.map(({ messages, ...t }) => ({ ...t, lastMessage: messages[0] ? this.message(messages[0]) : null }));
  }

  async counts() {
    const rows = await this.prisma.supportTicket.groupBy({ by: ['status'], _count: true });
    return Object.fromEntries(rows.map((r) => [r.status, r._count])) as Partial<Record<SupportTicketStatus, number>>;
  }

  async one(id: string) {
    const t = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' }, select: MESSAGE_SELECT },
      },
    });
    if (!t) throw new NotFoundException('Help request not found');
    const roles = await this.prisma.userRoleAssignment.findMany({
      where: { userId: t.userId, organizationId: t.organizationId },
      select: { role: { select: { name: true } } },
    });
    return { ...t, user: { ...t.user, roles: roles.map((r) => r.role.name) }, messages: t.messages.map((m) => this.message(m)) };
  }

  async agentReply(agent: SupportCaller, id: string, body: string, close: boolean) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Help request not found');
    await this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: close ? 'CLOSED' : 'ANSWERED',
        lastMessageAt: new Date(),
        messages: { create: { body, agentId: agent.agentId } },
      },
    });
    await this.prisma.supportAction.create({
      data: { agentId: agent.agentId, action: 'ticket.replied', organizationId: t.organizationId, userId: t.userId, detail: { ticketId: id, subject: t.subject, closed: close } },
    });
    this.tellCustomer(id, agent.name, body);
    return { ok: true };
  }

  async setStatus(agent: SupportCaller, id: string, status: SupportTicketStatus) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Help request not found');
    await this.prisma.supportTicket.update({ where: { id }, data: { status } });
    await this.prisma.supportAction.create({
      data: { agentId: agent.agentId, action: `ticket.${status.toLowerCase()}`, organizationId: t.organizationId, userId: t.userId, detail: { ticketId: id, subject: t.subject } },
    });
    return { ok: true };
  }

  // --- Emails ---------------------------------------------------------------------------

  private message(m: { id: string; body: string; createdAt: Date; agent: { name: string } | null; user: { firstName: string; lastName: string } | null }) {
    return {
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      fromSupport: !!m.agent,
      author: m.agent ? m.agent.name : m.user ? `${m.user.firstName} ${m.user.lastName}` : 'Someone',
    };
  }

  private later(task: () => Promise<unknown>) {
    setImmediate(() => task().catch((e) => this.log.error(`Help email failed: ${e instanceof Error ? e.message : e}`)));
  }

  // New request or customer reply → the support inbox (SUPPORT_INBOX).
  private tellSupport(ticketId: string, isNew: boolean) {
    const inbox = process.env.SUPPORT_INBOX?.trim();
    if (!inbox || !this.mailer.enabled) return;
    this.later(async () => {
      const t = await this.prisma.supportTicket.findUniqueOrThrow({
        where: { id: ticketId },
        include: {
          organization: { select: { name: true } },
          user: { select: { firstName: true, lastName: true, email: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      const who = `${t.user.firstName} ${t.user.lastName}`;
      const email = renderEmail(
        {
          subject: `${isNew ? 'New help request' : 'New reply'}: ${t.subject} — ${t.organization.name}`,
          title: isNew ? `${who} needs help` : `${who} replied`,
          lines: [
            `${who} (${t.user.email}) at ${t.organization.name}${t.page ? `, on ${t.page}` : ''}:`,
            ...paragraphs(t.messages[0]?.body ?? ''),
          ],
          button: { label: 'Open in the support console', url: `${appUrl()}/support/tickets/${t.id}` },
          footer: 'Reply from the support console so the customer sees it in HRM.',
        },
        'Quscer support',
      );
      await this.mailer.send({ to: inbox, ...email }, { kind: 'support_ticket_to_team', organizationId: t.organizationId });
    });
  }

  // Support answered → the person who asked.
  private tellCustomer(ticketId: string, agentName: string, body: string) {
    if (!this.mailer.enabled) return;
    this.later(async () => {
      const t = await this.prisma.supportTicket.findUniqueOrThrow({
        where: { id: ticketId },
        include: { organization: { select: { name: true } }, user: { select: { firstName: true, email: true, isActive: true } } },
      });
      if (!t.user.isActive) return;
      const email = renderEmail(
        {
          subject: `Quscer support replied: ${t.subject}`,
          title: 'Quscer support replied',
          lines: [`Hi ${t.user.firstName}, ${agentName} from Quscer support answered your question “${t.subject}”:`, ...paragraphs(body)],
          button: { label: 'Open in Quscer People', url: `${appUrl()}/help/${t.id}` },
          footer: 'Reply from "Get help" in Quscer People.',
        },
        t.organization.name,
      );
      await this.mailer.send({ to: t.user.email, ...email }, { kind: 'support_reply', organizationId: t.organizationId });
    });
  }
}

function paragraphs(body: string): string[] {
  const text = body.length > EMAIL_CHARS ? `${body.slice(0, EMAIL_CHARS)}…` : body;
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
}
