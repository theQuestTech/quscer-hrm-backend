import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { findEmployeeForUser } from './current-employee';
import { hasPermission } from '../rbac/rbac.service';

// Who an approver (leave / attendance) may see and act on:
//   - HR (can edit employees or company settings): everyone → null
//   - anyone else with an approve permission, i.e. a manager: only the
//     people who report directly to them (Employee.managerId).
// A manager with no employee profile has no team.
export type ApproverScope = string[] | null;

const HR_WIDE = ['hrm.employee.write', 'hrm.settings.write'];

export async function approverScope(
  prisma: PrismaService,
  organizationId: string,
  user: { id: string; permissions?: string[] },
): Promise<ApproverScope> {
  if (HR_WIDE.some((p) => hasPermission(user, p))) return null;
  const own = await findEmployeeForUser(prisma, organizationId, user.id);
  if (!own) return [];
  const team = await prisma.employee.findMany({
    where: { organizationId, managerId: own.id },
    select: { id: true },
  });
  return team.map((e) => e.id);
}

export function inScope(scope: ApproverScope, employeeId: string): boolean {
  return scope === null || scope.includes(employeeId);
}

export function assertInScope(scope: ApproverScope, employeeId: string) {
  if (!inScope(scope, employeeId)) {
    throw new ForbiddenException('You can only do this for people in your team');
  }
}
