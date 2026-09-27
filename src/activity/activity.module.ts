import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
