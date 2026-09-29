// Two-step sign-in for support staff. Always on: these accounts can open every
// company, so it can't be turned off and there's no "trust this computer".
// A lost phone: sign in with a backup code, or ask the support owner to reset it.

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { FieldEncryptionService } from '../crypto/field-encryption.service';
import { matchStep, newBackupCodes, newSecret, normalizeBackupCode, otpauthUrl } from '../two-step/totp';
import { CODE_REQUIRED, CODE_WRONG, SETUP_REQUIRED } from '../two-step/two-step.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class SupportTwoStepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldEncryptionService,
  ) {}

  async status(agentId: string) {
    const agent = await this.prisma.supportAgent.findUniqueOrThrow({ where: { id: agentId } });
    const backupCodesLeft = await this.prisma.supportAgentBackupCode.count({ where: { agentId, usedAt: null } });
    return { enabled: !!agent.totpEnabledAt, enabledAt: agent.totpEnabledAt, required: true, backupCodesLeft };
  }

  async startSetup(agentId: string) {
    const agent = await this.prisma.supportAgent.findUniqueOrThrow({ where: { id: agentId } });
    if (agent.totpEnabledAt) throw new BadRequestException('Two-step sign-in is already on');
    const secret = newSecret();
    await this.prisma.supportAgent.update({ where: { id: agentId }, data: { totpSecret: this.crypto.encrypt(secret), totpLastStep: null } });
    const url = otpauthUrl(secret, agent.email, 'Quscer HRM Support');
    return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
  }

  async confirmSetup(agentId: string, code: string) {
    const agent = await this.prisma.supportAgent.findUniqueOrThrow({ where: { id: agentId } });
    if (agent.totpEnabledAt) throw new BadRequestException('Two-step sign-in is already on');
    if (!agent.totpSecret) throw new BadRequestException('Start the setup first');
    const step = matchStep(this.crypto.decrypt(agent.totpSecret), code ?? '');
    if (step === null) throw new BadRequestException("That code isn't right — check the app and try the newest code");
    await this.prisma.supportAgent.update({ where: { id: agentId }, data: { totpEnabledAt: new Date(), totpLastStep: step } });
    await this.prisma.supportAction.create({ data: { agentId, action: 'agent.two_step_on' } });
    return { backupCodes: await this.replaceBackupCodes(agentId) };
  }

  async regenerateBackupCodes(agentId: string, code?: string) {
    await this.checkCode(agentId, code);
    return { backupCodes: await this.replaceBackupCodes(agentId) };
  }

  /** Each code works once. Throws a 403 the console understands (shows the code box). */
  async checkCode(agentId: string, code: string | undefined) {
    const agent = await this.prisma.supportAgent.findUnique({ where: { id: agentId } });
    if (!agent?.totpEnabledAt || !agent.totpSecret) throw new ForbiddenException({ code: SETUP_REQUIRED, message: 'Set up two-step sign-in first' });
    if (!code) throw new ForbiddenException({ code: CODE_REQUIRED, message: 'Type the code from your authenticator app to confirm' });
    const step = matchStep(this.crypto.decrypt(agent.totpSecret), code);
    const used =
      step === null ||
      (await this.prisma.supportAgent.updateMany({ where: { id: agentId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } })).count === 0;
    if (used) throw new ForbiddenException({ code: CODE_WRONG, message: "That code isn't right or was already used — wait for the next one" });
  }

  async useBackupCode(agentId: string, code: string): Promise<boolean> {
    const res = await this.prisma.supportAgentBackupCode.updateMany({ where: { agentId, codeHash: sha256(normalizeBackupCode(code)), usedAt: null }, data: { usedAt: new Date() } });
    return res.count === 1;
  }

  /** Owner only, with the owner's own code: for a lost phone with no backup codes left.
   *  They set it up again on their next visit. */
  async reset(caller: { agentId: string; isOwner: boolean }, targetId: string, code?: string) {
    if (!caller.isOwner) throw new ForbiddenException('Only the support owner can do this');
    if (targetId === caller.agentId) throw new BadRequestException('Ask another owner to reset yours, or use a backup code');
    const target = await this.prisma.supportAgent.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Not found');
    await this.checkCode(caller.agentId, code);
    await this.prisma.$transaction([
      this.prisma.supportAgent.update({ where: { id: targetId }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null } }),
      this.prisma.supportAgentBackupCode.deleteMany({ where: { agentId: targetId } }),
      this.prisma.supportAction.create({ data: { agentId: caller.agentId, action: 'agent.two_step_reset', detail: { email: target.email } } }),
    ]);
    return { ok: true };
  }

  private async replaceBackupCodes(agentId: string) {
    const codes = newBackupCodes();
    await this.prisma.$transaction([
      this.prisma.supportAgentBackupCode.deleteMany({ where: { agentId } }),
      this.prisma.supportAgentBackupCode.createMany({ data: codes.map((c) => ({ agentId, codeHash: sha256(normalizeBackupCode(c)) })) }),
    ]);
    return codes;
  }
}
