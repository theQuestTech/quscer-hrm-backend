import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard, READ_ONLY_MESSAGE } from './jwt-auth.guard';
import { forgetOrgStatus } from '../common/org-status';

function setup(payload: object, opts: { session?: object | null; suspended?: boolean } = {}) {
  const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
  const prisma = {
    supportViewSession: { findUnique: jest.fn().mockResolvedValue(opts.session ?? null) },
    organization: { findUnique: jest.fn().mockResolvedValue({ suspendedAt: opts.suspended ? new Date() : null }) },
  };
  const guard = new JwtAuthGuard(jwt as any, prisma as any);
  const run = (method: string, path = '/employees') => {
    const request: any = { method, path, headers: { authorization: 'Bearer t' } };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => request }) };
    return guard.canActivate(ctx).then(() => request.user);
  };
  return { run, prisma };
}

describe('JwtAuthGuard', () => {
  const base = { id: 'u1', organizationId: 'o1', email: 'a@b.pk' };
  beforeEach(() => forgetOrgStatus('o1'));

  it('lets a normal sign-in through', async () => {
    const user = await setup(base).run('POST');
    expect(user).toEqual(base);
  });

  it('refuses a switched-off company', async () => {
    await expect(setup(base, { suspended: true }).run('GET')).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('support view', () => {
    const view = { ...base, view: { sessionId: 's1', agentId: 'a1' } };
    const live = { userId: 'u1', endedAt: null, expiresAt: new Date(Date.now() + 60_000) };

    it('can read', async () => {
      const user = await setup(view, { session: live }).run('GET');
      expect(user.view).toEqual({ sessionId: 's1', agentId: 'a1' });
    });

    it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('cannot %s', async (method) => {
      await expect(setup(view, { session: live }).run(method)).rejects.toThrow(READ_ONLY_MESSAGE);
    });

    it('can end itself', async () => {
      await expect(setup(view, { session: live }).run('POST', '/auth/end-support-view')).resolves.toBeDefined();
    });

    it('stops once ended or expired', async () => {
      await expect(setup(view, { session: { ...live, endedAt: new Date() } }).run('GET')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(setup(view, { session: { ...live, expiresAt: new Date(Date.now() - 1) } }).run('GET')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(setup(view, { session: null }).run('GET')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses a session for someone else', async () => {
      await expect(setup(view, { session: { ...live, userId: 'u2' } }).run('GET')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
