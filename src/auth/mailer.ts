// Sends email through Resend (https://resend.com). Set RESEND_API_KEY on the
// server; RESEND_FROM picks the sender (the domain must be verified in
// Resend). Without a key, email is simply off and callers say so.
//
// Every email is noted in EmailLog (who to, what kind, whether it went) so
// support can answer "I never got the email". Resend's webhook later marks
// it delivered or bounced (see support/email-webhook.controller.ts).

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailMeta {
  kind: string;
  organizationId?: string | null;
}

const KEEP_DAYS = 90;

@Injectable()
export class Mailer {
  private readonly log = new Logger('Mailer');
  private lastPrune = 0;

  constructor(private prisma: PrismaService) {}

  get enabled(): boolean {
    return !!process.env.RESEND_API_KEY;
  }

  // Returns false if the email couldn't be sent. Never throws, so a mail
  // problem can't reveal anything to the person asking.
  async send(email: Email, meta: EmailMeta = { kind: 'other' }): Promise<boolean> {
    if (!this.enabled) return false;
    let ok = false;
    let error: string | null = null;
    let providerId: string | null = null;
    try {
      const res = await fetch(process.env.RESEND_API_URL ?? 'https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.RESEND_FROM ?? 'Quscer People <no-reply@quscer.com>',
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
      });
      const body = await res.text();
      if (res.ok) {
        ok = true;
        providerId = readJson(body, 'id');
      } else {
        error = `Refused (${res.status}): ${readJson(body, 'message') ?? (body.slice(0, 200) || 'no reason given')}`;
        this.log.error(`Resend refused an email (${res.status}): ${body.slice(0, 300)}`);
      }
    } catch (e) {
      error = 'Could not reach the email service';
      this.log.error(`Could not reach Resend: ${e instanceof Error ? e.message : e}`);
    }
    await this.record(email, meta, ok, error, providerId);
    return ok;
  }

  private async record(email: Email, meta: EmailMeta, ok: boolean, error: string | null, providerId: string | null) {
    try {
      // Resend's ids are unique; a stand-in used in tests may repeat one.
      const idFree = providerId && !(await this.prisma.emailLog.findUnique({ where: { providerId } }));
      await this.prisma.emailLog.create({
        data: {
          organizationId: meta.organizationId ?? null,
          to: email.to.toLowerCase(),
          kind: meta.kind,
          subject: email.subject.slice(0, 300),
          status: ok ? 'SENT' : 'FAILED',
          error: error?.slice(0, 500),
          providerId: idFree ? providerId : null,
        },
      });
      if (Date.now() - this.lastPrune > 24 * 60 * 60 * 1000) {
        this.lastPrune = Date.now();
        await this.prisma.emailLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
      }
    } catch (e) {
      this.log.error(`Could not record an email: ${e instanceof Error ? e.message : e}`);
    }
  }
}

function readJson(body: string, key: string): string | null {
  try {
    const v = JSON.parse(body)?.[key];
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}
