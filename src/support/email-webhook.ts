// Resend tells us what happened to each email after it left: delivered,
// bounced (e.g. the mailbox doesn't exist) or marked as spam. Set up in
// Resend → Webhooks with the URL https://<api>/webhooks/resend and the
// events email.delivered, email.bounced, email.complained, email.failed;
// put its signing secret in RESEND_WEBHOOK_SECRET.
//
// Resend signs with Svix: HMAC-SHA256 of "<id>.<timestamp>.<body>" using
// the base64 secret after "whsec_", sent as "v1,<base64>" (maybe several).

import { Controller, HttpCode, Logger, NotFoundException, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import type { EmailStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const TOLERANCE_SECONDS = 5 * 60;

export function verifySvix(
  secret: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const STATUS: Record<string, EmailStatus> = {
  'email.delivered': 'DELIVERED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINED',
  'email.failed': 'FAILED',
};

@Controller('webhooks')
export class EmailWebhookController {
  private readonly log = new Logger('EmailWebhook');

  constructor(private prisma: PrismaService) {}

  @Post('resend')
  @HttpCode(200)
  async resend(@Req() req: Request) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new NotFoundException();
    const body = typeof req.body === 'string' ? req.body : '';
    const ok = verifySvix(
      secret,
      { id: req.header('svix-id'), timestamp: req.header('svix-timestamp'), signature: req.header('svix-signature') },
      body,
    );
    if (!ok) throw new UnauthorizedException('Bad signature');
    let event: { type?: string; data?: { email_id?: string; bounce?: { message?: string }; failed?: { reason?: string } } };
    try {
      event = JSON.parse(body);
    } catch {
      return { ok: true };
    }
    const status = event.type ? STATUS[event.type] : undefined;
    const providerId = event.data?.email_id;
    if (!status || !providerId) return { ok: true };
    const reason = event.data?.bounce?.message ?? event.data?.failed?.reason ?? null;
    const updated = await this.prisma.emailLog.updateMany({
      // A late "delivered" never hides an earlier bounce or complaint.
      where: { providerId, ...(status === 'DELIVERED' && { status: { in: ['SENT', 'DELIVERED'] } }) },
      data: { status, ...(reason && { error: String(reason).slice(0, 500) }) },
    });
    if (!updated.count) this.log.debug(`No email ${providerId} for ${event.type}`);
    return { ok: true };
  }
}
