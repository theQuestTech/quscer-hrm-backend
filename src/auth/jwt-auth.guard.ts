import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SUSPENDED_MESSAGE, isSuspended } from '../common/org-status';

export interface RequestUser {
  id: string;
  organizationId: string;
  email: string;
  // Set when Quscer support is looking at HRM as this person (read-only).
  view?: { sessionId: string; agentId: string };
  // Two-step sign-in is required but not set up yet (only setup is open).
  tsr?: boolean;
}

// While two-step setup is pending, only these open (the app reads /auth/me to
// know where to send the person).
const TWO_STEP_SETUP_PATHS = ['/auth/two-step', '/auth/me'];

// The only change a support view may make: ending itself.
const END_VIEW_PATH = '/auth/end-support-view';
export const READ_ONLY_MESSAGE = 'This is a read-only Quscer support view — nothing can be changed.';

// Standalone JWT validation for now. Once this app is connected to Quscer OS
// (WBS 6.1 — "Synchronize Quscer user profile across subscribed apps"), this
// should validate the shared Quscer session token instead of issuing/checking
// its own — do not build long-lived local password auth beyond this scaffold.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice('Bearer '.length);

    let payload: RequestUser;
    try {
      payload = await this.jwtService.verifyAsync<RequestUser>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!payload.id || !payload.organizationId) throw new UnauthorizedException('Invalid or expired token');

    if (payload.view) {
      // Support view: look, never touch. It also ends early when support
      // (or the viewer) ends it.
      const method = String(request.method).toUpperCase();
      if (method !== 'GET' && method !== 'HEAD' && !(method === 'POST' && request.path === END_VIEW_PATH)) {
        throw new ForbiddenException(READ_ONLY_MESSAGE);
      }
      const session = await this.prisma.supportViewSession.findUnique({ where: { id: payload.view.sessionId } });
      if (!session || session.endedAt || session.expiresAt < new Date() || session.userId !== payload.id) {
        throw new UnauthorizedException('The support view has ended');
      }
    } else if (await isSuspended(this.prisma, payload.organizationId)) {
      throw new ForbiddenException(SUSPENDED_MESSAGE);
    }

    if (payload.tsr && !TWO_STEP_SETUP_PATHS.some((p) => String(request.path ?? '').startsWith(p))) {
      throw new ForbiddenException({ code: 'TWO_STEP_SETUP_REQUIRED', message: 'Set up two-step sign-in to continue' });
    }

    request.user = {
      id: payload.id,
      organizationId: payload.organizationId,
      email: payload.email,
      ...(payload.tsr && { tsr: true }),
      ...(payload.view && { view: { sessionId: payload.view.sessionId, agentId: payload.view.agentId } }),
    } satisfies RequestUser;
    return true;
  }
}
