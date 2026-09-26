// "Forgot password?" by email. Works for everyone, including a company's
// only HR admin. The answer to "send me a link" is always the same whether
// or not the email has an account, so nobody can use it to find out who
// has one. Links work once, expire after an hour, and only their hash is
// stored.

import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Mailer } from './mailer';

export const RESET_LINK_MINUTES = 60;
const SALT_ROUNDS = 10;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function resetEmail(firstName: string, link: string) {
  const name = escapeHtml(firstName);
  return {
    subject: 'Reset your Quscer People password',
    text:
      `Hi ${firstName},\n\nSomeone (hopefully you) asked to reset your Quscer People password.\n` +
      `Open this link to choose a new one. It works once and expires in ${RESET_LINK_MINUTES} minutes:\n\n${link}\n\n` +
      `If you didn't ask, ignore this email — your password stays the same.\n\nQuscer People`,
    html: `<!doctype html><html><body style="margin:0;background:#f6f8fa;font-family:Arial,Helvetica,sans-serif;color:#1a1a2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:18px;font-weight:bold;color:#00857a;padding-bottom:20px">Quscer People</td></tr>
<tr><td style="font-size:20px;font-weight:bold;padding-bottom:12px">Reset your password</td></tr>
<tr><td style="font-size:14px;line-height:22px;color:#4b5563;padding-bottom:24px">Hi ${name}, someone (hopefully you) asked to reset your Quscer People password. The button works once and expires in ${RESET_LINK_MINUTES} minutes.</td></tr>
<tr><td style="padding-bottom:24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#00857a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 24px;border-radius:10px">Choose a new password</a></td></tr>
<tr><td style="font-size:12px;line-height:18px;color:#9ca3af">If you didn't ask, ignore this email — your password stays the same.</td></tr>
</table></td></tr></table></body></html>`,
  };
}

@Injectable()
export class PasswordResetService {
  constructor(
    private prisma: PrismaService,
    private mailer: Mailer,
  ) {}

  // The same reply for every request.
  answer() {
    return { ok: true as const, emailEnabled: this.mailer.enabled };
  }

  async request(emailAddress: string): Promise<{ ok: true; emailEnabled: boolean }> {
    const answer = this.answer();
    if (!this.mailer.enabled) return answer;
    // The login this email opens (see AuthService.login for older duplicates).
    const user = await this.prisma.user.findFirst({
      where: { email: emailAddress.trim().toLowerCase(), isActive: true, passwordHash: { not: null }, memberships: { some: { isActive: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) return answer;
    const token = newToken();
    await this.prisma.$transaction([
      // Only the newest link works.
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_LINK_MINUTES * 60_000) },
      }),
    ]);
    const appUrl = (process.env.APP_URL ?? 'https://hrm.quscer.com').replace(/\/$/, '');
    const email = resetEmail(user.firstName, `${appUrl}/reset-password?token=${token}`);
    await this.mailer.send({ to: user.email, ...email });
    await this.prisma.auditEvent.create({
      data: { organizationId: user.organizationId, actorUserId: user.id, eventType: 'user.password_reset_requested', entityType: 'User', entityId: user.id },
    });
    return answer;
  }

  async reset(token: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
      throw new BadRequestException('This link has expired or was already used. Ask for a new one.');
    }
    // Mark it used first, so two clicks at once can't both succeed.
    const claimed = await this.prisma.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw new BadRequestException('This link has expired or was already used. Ask for a new one.');
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) },
    });
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } });
    await this.prisma.auditEvent.create({
      data: {
        organizationId: record.user.organizationId,
        actorUserId: record.userId,
        eventType: 'user.password_reset_by_email',
        entityType: 'User',
        entityId: record.userId,
      },
    });
    return { ok: true };
  }
}
