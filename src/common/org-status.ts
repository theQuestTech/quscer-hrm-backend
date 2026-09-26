import { PrismaService } from '../prisma/prisma.service';

// Whether Quscer support has switched a company off. Checked on every
// signed-in request, so the answer is kept for a short while.
const CACHE_MS = 30_000;
const cache = new Map<string, { suspended: boolean; at: number }>();

export const SUSPENDED_MESSAGE =
  "This company's Quscer People account is switched off. Please contact Quscer support.";

export async function isSuspended(prisma: PrismaService, organizationId: string): Promise<boolean> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.suspended;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { suspendedAt: true } });
  const suspended = !!org?.suspendedAt;
  cache.set(organizationId, { suspended, at: Date.now() });
  return suspended;
}

// Called when support switches a company off or on.
export function forgetOrgStatus(organizationId: string) {
  cache.delete(organizationId);
}
