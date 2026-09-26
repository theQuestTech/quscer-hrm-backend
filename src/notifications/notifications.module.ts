import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { MailModule } from './mail.module';
import { NotificationsController } from './notifications.controller';
import { NotifyService } from './notify.service';
import { RemindersService } from './reminders.service';

// Global so any module can send notifications without importing this.
@Global()
@Module({
  imports: [AuthModule, RbacModule, MailModule],
  controllers: [NotificationsController],
  providers: [NotifyService, RemindersService],
  exports: [NotifyService],
})
export class NotificationsModule {}
