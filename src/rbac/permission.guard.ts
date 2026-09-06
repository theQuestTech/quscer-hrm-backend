// WBS 1.8 — Role assignment and permission evaluation service
//
// Usage:
//   @RequirePermission('hrm.employee.read')
//   @UseGuards(JwtAuthGuard, PermissionGuard)
//   @Get('employees')
//   listEmployees() { ... }
//
// Effective permission = UNION of every role's permissions assigned to the
// user within their organization (default deny). Order matters: JwtAuthGuard
// must run first so request.user is populated before this guard reads it.

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';

export const PERMISSION_KEY = 'requiredPermission';

export const RequirePermission = (permissionKey: string) =>
  SetMetadata(PERMISSION_KEY, permissionKey);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredKey = this.reflector.get<string>(
      PERMISSION_KEY,
      context.getHandler(),
    );

    if (!requiredKey) return true; // no permission required on this route

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    const organizationId: string | undefined = request.user?.organizationId;

    if (!userId || !organizationId) {
      throw new ForbiddenException('No authenticated user/organization context');
    }

    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: { userId, organizationId },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
      },
    });

    const effectivePermissionKeys = new Set(
      assignments.flatMap((a) =>
        a.role.permissions.map((rp) => rp.permission.key),
      ),
    );

    if (!effectivePermissionKeys.has(requiredKey)) {
      throw new ForbiddenException(`Missing permission: ${requiredKey}`);
    }

    return true;
  }
}
