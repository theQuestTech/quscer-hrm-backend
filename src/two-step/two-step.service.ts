import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { FieldEncryptionService } from '../crypto/field-encryption.service';
import { RbacService } from '../rbac/rbac.service';
import { matchStep, newBackupCodes, newSecret, normalizeBackupCode, otpauthUrl } from './totp';

/** Anyone who can pay people, change employee records (bank details) or change
 *  company settings must use two-step sign-in. */
export const TWO_STEP_PERMISSIONS = ['hrm.payroll.write', 'hrm.payroll.run', 'hrm.payroll.approve', 'hrm.employee.write', 'hrm.settings.write'];

export const CODE_REQUIRED = 'TWO_STEP_CODE_REQUIRED';
export const CODE_WRONG = 'TWO_STEP_CODE_WRONG';
export const SETUP_REQUIRED = 'TWO_STEP_SETUP_REQUIRED';
const TRUST_DAYS = 30;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class TwoStepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldEncryptionService,
    private readonly rbac: RbacService,
  ) {}

  /** Required in this company: a pay/records/settings permission, or the company asks everyone. */
  async isRequired(userId: string, organizationId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { requireTwoStepForAll: true } });
    if (org?.requireTwoStepForAll) return true;
    const perms = await this.rbac.getEffectivePermissions(userId, organizationId);
    return TWO_STEP_PERMISSIONS.some((p) => perms.has(p));
  }

  async setupPending(userId: string, organizationId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } });
    return !user?.totpEnabledAt && (await this.isRequired(userId, organizationId));
  }

  async status(userId: string, organizationId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const [backupCodesLeft, trustedDevices, required] = await Promise.all([
      this.prisma.twoStepBackupCode.count({ where: { userId, usedAt: null } }),
      this.prisma.trustedDevice.count({ where: { userId, expiresAt: { gt: new Date() } } }),
      this.isRequired(userId, organizationId),
    ]);
    return { enabled: !!user.totpEnabledAt, enabledAt: user.totpEnabledAt, required, backupCodesLeft, trustedDevices };
  }

  async startSetup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new BadRequestException('Two-step sign-in is already on');
    const secret = newSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: this.crypto.encrypt(secret), totpLastStep: null } });
    const url = otpauthUrl(secret, user.email, 'Quscer HRM');
    return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
  }

  async confirmSetup(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new BadRequestException('Two-step sign-in is already on');
    if (!user.totpSecret) throw new BadRequestException('Start the setup first');
    const step = matchStep(this.crypto.decrypt(user.totpSecret), code);
    if (step === null) throw new BadRequestException("That code isn't right — check the app and try the newest code");
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date(), totpLastStep: step } });
    return { backupCodes: await this.replaceBackupCodes(userId) };
  }

  async regenerateBackupCodes(userId: string, code: string) {
    await this.checkCode(userId, code);
    return { backupCodes: await this.replaceBackupCodes(userId) };
  }

  async disable(userId: string, organizationId: string, code: string) {
    // Required in any of their companies → can't be turned off.
    const memberships = await this.prisma.membership.findMany({ where: { userId, isActive: true }, select: { organizationId: true } });
    for (const m of memberships.length ? memberships : [{ organizationId }]) {
      if (await this.isRequired(userId, m.organizationId)) throw new ForbiddenException('Two-step sign-in is required for your role, so it can’t be turned off');
    }
    await this.checkCode(userId, code);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null } }),
      this.prisma.twoStepBackupCode.deleteMany({ where: { userId } }),
      this.prisma.trustedDevice.deleteMany({ where: { userId } }),
    ]);
    return { enabled: false };
  }

  /** Checks an authenticator code; each code works once. Throws if wrong. */
  async checkCode(userId: string, code: string | undefined) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpEnabledAt || !user.totpSecret) {
      throw new ForbiddenException({ code: SETUP_REQUIRED, message: 'Turn on two-step sign-in (Settings › Two-step sign-in) to do this' });
    }
    if (!code) throw new ForbiddenException({ code: CODE_REQUIRED, message: 'Type the code from your authenticator app to confirm' });
    const step = matchStep(this.crypto.decrypt(user.totpSecret), code);
    const used =
      step === null ||
      (await this.prisma.user.updateMany({ where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } })).count === 0;
    if (used) throw new ForbiddenException({ code: CODE_WRONG, message: "That code isn't right or was already used — wait for the next one" });
  }

  /** "Confirm it's you" for a sensitive action; the code comes in the X-Two-Step-Code header. */
  async requireCode(req: { user: { id: string }; headers: Record<string, unknown> }) {
    const code = req.headers['x-two-step-code'];
    await this.checkCode(req.user.id, typeof code === 'string' ? code : undefined);
  }

  async useBackupCode(userId: string, code: string): Promise<boolean> {
    const res = await this.prisma.twoStepBackupCode.updateMany({ where: { userId, codeHash: sha256(normalizeBackupCode(code)), usedAt: null }, data: { usedAt: new Date() } });
    return res.count === 1;
  }

  async trustDevice(userId: string, userAgent?: string) {
    const raw = randomBytes(32).toString('hex');
    await this.prisma.trustedDevice.create({ data: { userId, tokenHash: sha256(raw), userAgent: userAgent?.slice(0, 300), expiresAt: new Date(Date.now() + TRUST_DAYS * 86400000) } });
    return raw;
  }

  async isTrusted(userId: string, raw?: string) {
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return false;
    const res = await this.prisma.trustedDevice.updateMany({ where: { userId, tokenHash: sha256(raw), expiresAt: { gt: new Date() } }, data: { lastUsedAt: new Date() } });
    return res.count === 1;
  }

  async forgetDevices(userId: string) {
    const res = await this.prisma.trustedDevice.deleteMany({ where: { userId } });
    return { removed: res.count };
  }

  /** Others in the company who hold a permission — for "a different person must approve".
   *  One query, same rule as RbacService.getEffectivePermissions (an active member with
   *  a role in this company that carries the permission). */
  async othersWithPermission(organizationId: string, userId: string, permission: string) {
    const rows = await this.prisma.userRoleAssignment.findMany({
      where: {
        organizationId,
        userId: { not: userId },
        user: { isActive: true, memberships: { some: { organizationId, isActive: true } } },
        role: { permissions: { some: { permission: { key: permission } } } },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((r) => r.userId);
  }

  /** Maker-checker: whoever prepared something can't also approve it — unless
   *  nobody else in the company holds the approve permission, in which case they
   *  go ahead alone (with their code) and it's recorded as "approved alone".
   *  Checks the code too. Returns true when approved alone. */
  async approveCheck(req: { user: { id: string; organizationId: string }; headers: Record<string, unknown> }, makerId: string | null | undefined, permission: string, what: string) {
    let alone = false;
    if (makerId && makerId === req.user.id) {
      if ((await this.othersWithPermission(req.user.organizationId, req.user.id, permission)).length) {
        throw new ForbiddenException(`You prepared this ${what}, so a different person has to approve it`);
      }
      alone = true;
    }
    await this.requireCode(req as never);
    return alone;
  }

  private async replaceBackupCodes(userId: string) {
    const codes = newBackupCodes();
    await this.prisma.$transaction([
      this.prisma.twoStepBackupCode.deleteMany({ where: { userId } }),
      this.prisma.twoStepBackupCode.createMany({ data: codes.map((c) => ({ userId, codeHash: sha256(normalizeBackupCode(c)) })) }),
    ]);
    return codes;
  }
}
