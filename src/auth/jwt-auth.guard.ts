import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface RequestUser {
  id: string;
  organizationId: string;
  email: string;
}

// Standalone JWT validation for now. Once this app is connected to Quscer OS
// (WBS 6.1 — "Synchronize Quscer user profile across subscribed apps"), this
// should validate the shared Quscer session token instead of issuing/checking
// its own — do not build long-lived local password auth beyond this scaffold.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice('Bearer '.length);

    try {
      const payload = await this.jwtService.verifyAsync<RequestUser>(token);
      request.user = {
        id: payload.id,
        organizationId: payload.organizationId,
        email: payload.email,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
