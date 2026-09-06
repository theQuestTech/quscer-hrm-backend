import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Mirrors prisma/seed.ts DEFAULT_ROLES — kept in one place so signup and the
// CLI seed script don't drift apart. If you change one, change both (or
// better: have seed.ts import DEFAULT_ROLES from here once ts-node path
// resolution is set up — left as plain duplication for now to keep the seed
// script dependency-free).
const DEFAULT_ROLES: Record<string, string[]> = {
  'HR Admin': [
    'hrm.employee.read', 'hrm.employee.write', 'hrm.attendance.read',
    'hrm.attendance.approve', 'hrm.leave.read', 'hrm.leave.approve',
    'hrm.payroll.read', 'hrm.payroll.write', 'hrm.reports.read', 'hrm.settings.write',
  ],
  'Payroll Approver': [
    'hrm.payroll.read', 'hrm.payroll.write', 'hrm.payroll.run', 'hrm.payroll.approve', 'hrm.reports.read',
  ],
  Manager: [
    'hrm.employee.read', 'hrm.attendance.read', 'hrm.attendance.approve',
    'hrm.leave.read', 'hrm.leave.approve',
  ],
  Employee: ['hrm.leave.read', 'hrm.attendance.read'],
};

@Injectable()
export class RbacService {
  constructor(private prisma: PrismaService) {}

  // Call once per new organization (from signup). Assumes the global
  // Permission catalog has already been seeded via `npm run prisma:seed`
  // (prisma/seed.ts) — if it hasn't, this creates roles with zero
  // permissions attached rather than failing loudly. See note in
  // AuthService.signup for why that's checked explicitly there.
  async seedDefaultRolesForOrganization(organizationId: string) {
    const createdRoles: Record<string, string> = {};

    for (const [roleName, permKeys] of Object.entries(DEFAULT_ROLES)) {
      const role = await this.prisma.role.create({
        data: { organizationId, name: roleName, isSystemRole: true },
      });
      const perms = await this.prisma.permission.findMany({
        where: { key: { in: permKeys } },
      });
      if (perms.length > 0) {
        await this.prisma.rolePermission.createMany({
          data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
        });
      }
      createdRoles[roleName] = role.id;
    }

    return createdRoles;
  }
}
