import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isStaging } from '../common/environment';
import { DEMO } from '../scripts/demo-seed';
import { simulateNow } from './demo-tracking';

// Staging only: every two minutes, the demo company's field staff move on along
// their routes, so the Field team map is live during a demo. Does nothing if the
// demo company isn't there or support switched its field tracking off.
@Injectable()
export class DemoTrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('DemoTracking');
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    if (!isStaging()) return;
    this.timer = setInterval(() => this.tick().catch((e) => this.log.warn(`Demo tracking: ${e instanceof Error ? e.message : e}`)), 2 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    const org = await this.prisma.organization.findFirst({
      where: { name: DEMO.companyName, suspendedAt: null, fieldTrackingSince: { not: null } },
      select: { id: true },
    });
    if (!org) return { points: 0 };
    return simulateNow(this.prisma, org.id, now);
  }
}
