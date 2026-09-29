// Sign-in for Quscer's own support staff — separate from customer logins.
// Their tokens are signed with a different secret, so a customer token can
// never open the console and a support token can never open a company.
//
// The first staff member is SUPPORT_OWNER_EMAIL: on start-up they're added
// (if missing) and choose a password with "Forgot / set password" on the
// console's sign-in page. They add everyone else from "Support team".

import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Mailer } from '../auth/mailer';
import { appUrl, hashToken, newToken } from '../auth/password-reset';
import { renderEmail } from '../notifications/email-layout';

export const SUPPORT_JWT = 'SUPPORT_JWT';
const SALT_ROUNDS = 12;
const LINK_MINUTES = 60;
const NEW_AGENT_LINK_MINUTES = 3 * 24 * 60;

export interface SupportCaller {
  agentId: string;
  isOwner: boolean;
  name: string;
  email: string;
}

export function supportSecret(): string {
  const own = process.env.SUPPORT_JWT_SECRET;
  if (own) return own;
  const main = process.env.JWT_SECRET;
  if (!main) throw new Error('JWT_SECRET is not set');
  return createHash('sha256').update(`quscer-support:${main}`).digest('hex');
}

export const supportJwtProvider = {
  provide: SUPPORT_JWT,
  useFactory: () => new JwtService({ secret: supportSecret(), signOptions: { expiresIn: '8h' } }),
};

@Injectable()
export class SupportGuard implements CanActivate {
  constructor(
    @Inject(SUPPORT_JWT) private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Please sign in');
    let payload: { sub?: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new UnauthorizedException('Your support session has ended — please sign in again');
    }
    if (payload.typ !== 'support' || !payload.sub) throw new UnauthorizedException('Please sign in');
    const agent = await this.prisma.supportAgent.findUnique({ where: { id: payload.sub } });
    if (!agent?.isActive) throw new UnauthorizedException('This support account is switched off');
    request.agent = { agentId: agent.id, isOwner: agent.isOwner, name: agent.name, email: agent.email } satisfies SupportCaller;
    return true;
  }
}

@Injectable()
export class SupportAuthService implements OnModuleInit {
  private readonly log = new Logger('Support');
  private dummyHash: string | undefined;

  constructor(
    @Inject(SUPPORT_JWT) private jwt: JwtService,
    private prisma: PrismaService,
    private mailer: Mailer,
  ) {}

  // Makes sure SUPPORT_OWNER_EMAIL has an owner account.
  async onModuleInit() {
    const email = process.env.SUPPORT_OWNER_EMAIL?.trim().toLowerCase();
    if (!email) return;
    try {
      await this.prisma.supportAgent.upsert({
        where: { email },
        update: { isOwner: true, isActive: true },
        create: { email, name: email.split('@')[0], isOwner: true },
      });
    } catch (e) {
      this.log.error(`Could not set up the support owner: ${e instanceof Error ? e.message : e}`);
    }
  }

  async login(email: string, password: string) {
    const agent = await this.prisma.supportAgent.findUnique({ where: { email: email.trim().toLowerCase() } });
    // Compare even when there's no account, so timing doesn't tell.
    this.dummyHash ??= await bcrypt.hash('not-a-password', SALT_ROUNDS);
    const ok = await bcrypt.compare(password, agent?.passwordHash ?? this.dummyHash);
    if (!agent?.isActive || !agent.passwordHash || !ok) throw new UnauthorizedException('Wrong email or password');
    await this.prisma.supportAgent.update({ where: { id: agent.id }, data: { lastLoginAt: new Date() } });
    return { accessToken: await this.jwt.signAsync({ sub: agent.id, typ: 'support' }) };
  }

  me(caller: SupportCaller) {
    return { id: caller.agentId, name: caller.name, email: caller.email, isOwner: caller.isOwner };
  }

  // Same answer whether or not the email is a support account.
  async forgot(email: string) {
    const agent = await this.prisma.supportAgent.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (agent?.isActive) await this.sendPasswordLink(agent.id, LINK_MINUTES, false);
    return { ok: true, emailEnabled: this.mailer.enabled };
  }

  async reset(token: string, newPassword: string) {
    const record = await this.prisma.supportAgentToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { agent: true } });
    const bad = () => new BadRequestException('This link has expired or was already used. Ask for a new one.');
    if (!record || record.usedAt || record.expiresAt < new Date() || !record.agent.isActive) throw bad();
    const claimed = await this.prisma.supportAgentToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count === 0) throw bad();
    await this.prisma.supportAgent.update({
      where: { id: record.agentId },
      data: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) },
    });
    await this.prisma.supportAgentToken.deleteMany({ where: { agentId: record.agentId, usedAt: null } });
    await this.prisma.supportAction.create({ data: { agentId: record.agentId, action: 'agent.password_set' } });
    return { ok: true };
  }

  // --- Support team (owners only) ---------------------------------------------------

  team() {
    return this.prisma.supportAgent.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, email: true, name: true, isOwner: true, isActive: true, lastLoginAt: true, createdAt: true, passwordHash: true },
    }).then((agents) => agents.map(({ passwordHash, ...a }) => ({ ...a, hasPassword: !!passwordHash })));
  }

  async addAgent(caller: SupportCaller, email: string, name: string) {
    this.ownerOnly(caller);
    const address = email.trim().toLowerCase();
    if (await this.prisma.supportAgent.findUnique({ where: { email: address } })) {
      throw new BadRequestException('That email is already on the support team');
    }
    const agent = await this.prisma.supportAgent.create({ data: { email: address, name } });
    await this.sendPasswordLink(agent.id, NEW_AGENT_LINK_MINUTES, true);
    await this.prisma.supportAction.create({ data: { agentId: caller.agentId, action: 'agent.added', detail: { email: address, name } } });
    return { id: agent.id, emailSent: this.mailer.enabled };
  }

  // Anyone can change their own name; the owner can change anyone's.
  async rename(caller: SupportCaller, agentId: string, name: string) {
    if (agentId !== caller.agentId) this.ownerOnly(caller);
    const agent = await this.prisma.supportAgent.findUnique({ where: { id: agentId } });
    if (!agent) throw new BadRequestException('Not found');
    if (agent.name === name) return { ok: true };
    await this.prisma.supportAgent.update({ where: { id: agentId }, data: { name } });
    await this.prisma.supportAction.create({
      data: { agentId: caller.agentId, action: 'agent.renamed', detail: { email: agent.email, from: agent.name, to: name } },
    });
    return { ok: true };
  }

  async setActive(caller: SupportCaller, agentId: string, isActive: boolean) {
    this.ownerOnly(caller);
    if (agentId === caller.agentId) throw new BadRequestException("You can't switch off your own account");
    const agent = await this.prisma.supportAgent.findUnique({ where: { id: agentId } });
    if (!agent) throw new BadRequestException('Not found');
    await this.prisma.supportAgent.update({ where: { id: agentId }, data: { isActive } });
    await this.prisma.supportAction.create({
      data: { agentId: caller.agentId, action: isActive ? 'agent.switched_on' : 'agent.switched_off', detail: { email: agent.email } },
    });
    return { ok: true };
  }

  private ownerOnly(caller: SupportCaller) {
    if (!caller.isOwner) throw new ForbiddenException('Only the support owner can change the team');
  }

  private async sendPasswordLink(agentId: string, minutes: number, isNew: boolean) {
    const agent = await this.prisma.supportAgent.findUniqueOrThrow({ where: { id: agentId } });
    const token = newToken();
    await this.prisma.$transaction([
      this.prisma.supportAgentToken.deleteMany({ where: { agentId, usedAt: null } }),
      this.prisma.supportAgentToken.create({
        data: { agentId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + minutes * 60_000) },
      }),
    ]);
    const link = `${appUrl()}/support/reset-password?token=${token}`;
    const hours = Math.round(minutes / 60);
    const email = renderEmail(
      {
        subject: isNew ? "You've been added to Quscer support" : 'Your Quscer support password',
        title: isNew ? 'Welcome to the Quscer support team' : 'Choose a new password',
        lines: [
          `Hi ${agent.name}, ${isNew ? "you've been added to the Quscer People support console." : 'someone (hopefully you) asked to set your support console password.'}`,
          `The link works once and expires in ${hours === 1 ? '1 hour' : `${hours} hours`}. Use at least 12 characters.`,
        ],
        button: { label: 'Choose my password', url: link },
        footer: "If you didn't expect this, ignore it — nothing changes.",
      },
      'Quscer support',
    );
    await this.mailer.send({ to: agent.email, ...email }, { kind: 'support_password' });
  }
}
