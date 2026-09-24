import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Resolves a logged-in User to their linked Employee record. Employee.userId
// is optional — not every employee has login access, and an HR admin may not
// have an employee profile — so callers pick between "may be null" and
// "throw clearly" instead of silently acting as nobody.

export function findEmployeeForUser(
  prisma: PrismaService,
  organizationId: string,
  userId: string,
) {
  return prisma.employee.findFirst({
    where: { organizationId, userId },
    include: { branch: true },
  });
}

export async function requireEmployeeForUser(
  prisma: PrismaService,
  organizationId: string,
  userId: string,
) {
  const employee = await findEmployeeForUser(prisma, organizationId, userId);
  if (!employee) {
    throw new BadRequestException(
      'No employee record is linked to this user account',
    );
  }
  return employee;
}
