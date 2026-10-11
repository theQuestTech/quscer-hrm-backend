import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TrackingService } from './tracking.service';

// Once a day: delete positions older than each company's keep period.
@Injectable()
export class TrackingCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('TrackingCleanup');
  private timers: NodeJS.Timeout[] = [];

  constructor(private tracking: TrackingService) {}

  onModuleInit() {
    const run = () =>
      this.tracking
        .deleteOld()
        .then((r) => r.deleted && this.log.log(`Deleted ${r.deleted} old positions`))
        .catch((e) => this.log.error(`Clean-up failed: ${e instanceof Error ? e.message : e}`));
    this.timers.push(setTimeout(run, 5 * 60 * 1000));
    this.timers.push(setInterval(run, 24 * 60 * 60 * 1000));
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }
}
