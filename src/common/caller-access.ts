import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { findActiveMembership } from './membership';
import { findEmployeeForUser } from './current-employee';

export type Caller = { id: string; organizationId: string };

// HR = can edit employees or company settings.
export const HR_WIDE = ['hrm.employee.write', 'hrm.settings.write'];

// Who is asking: must still have access to this company; whether they are
// HR; and their own employee record (if any).
export async function callerAccess(prisma: PrismaService, rbac: RbacService, caller: Caller) {
  if (!(await findActiveMembership(prisma, caller.id, caller.organizationId))) {
    throw new ForbiddenException("You don't have access to this company");
  }
  const permissions = await rbac.getEffectivePermissions(caller.id, caller.organizationId);
  const isHr = HR_WIDE.some((p) => permissions.has(p));
  const own = await findEmployeeForUser(prisma, caller.organizationId, caller.id);
  return { isHr, own, permissions };
}
