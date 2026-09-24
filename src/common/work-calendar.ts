import { PrismaService } from '../prisma/prisma.service';
import { dayKey, startOfDayUtc, workingDays } from './dates';

const DEFAULT_WEEKEND_DAYS = [0, 6];

// The org's weekend days plus every holiday in [from, to] that applies to
// this branch (org-wide holidays have branchId null).
export async function loadWorkCalendar(
  prisma: PrismaService,
  organizationId: string,
  branchId: string | null | undefined,
  from: Date,
  to: Date,
) {
  const [settings, holidays] = await Promise.all([
    prisma.organizationLocaleSettings.findUnique({ where: { organizationId } }),
    prisma.holiday.findMany({
      where: {
        organizationId,
        date: { gte: startOfDayUtc(from), lte: startOfDayUtc(to) },
        OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])],
      },
    }),
  ]);
  return {
    weekendDays: settings?.weekendDays ?? DEFAULT_WEEKEND_DAYS,
    holidayKeys: new Set(holidays.map((h) => dayKey(h.date))),
  };
}

export async function countWorkingDays(
  prisma: PrismaService,
  organizationId: string,
  branchId: string | null | undefined,
  from: Date,
  to: Date,
) {
  const { weekendDays, holidayKeys } = await loadWorkCalendar(prisma, organizationId, branchId, from, to);
  return workingDays(from, to, weekendDays, holidayKeys).length;
}
