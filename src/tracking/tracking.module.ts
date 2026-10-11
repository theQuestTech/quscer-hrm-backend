import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { TrackingCleanupService } from './tracking-cleanup.service';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [TrackingController],
  providers: [TrackingService, TrackingCleanupService],
  exports: [TrackingService],
})
export class TrackingModule {}
