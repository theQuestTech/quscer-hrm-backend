import { PrismaService } from '../prisma/prisma.service';

// A login can open a company only while both the login and its membership
// of that company are active. Used wherever "is this person still in this
// company?" matters, instead of User.organizationId (which is only the
// company they first signed up in).
export function findActiveMembership(prisma: PrismaService, userId: string, organizationId: string) {
  return prisma.membership.findFirst({
    where: { userId, organizationId, isActive: true, user: { isActive: true } },
  });
}
