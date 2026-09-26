import { Controller, ForbiddenException, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { callerAccess } from '../common/caller-access';
import { RemindersService } from './reminders.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private reminders: RemindersService,
    private prisma: PrismaService,
    private rbac: RbacService,
  ) {}

  // HR can run today's expiry reminders now (they also run on their own).
  // Safe to press twice: each reminder is only ever sent once.
  @Post('reminders/run')
  @HttpCode(200)
  async runReminders(@Req() req: any) {
    const a = await callerAccess(this.prisma, this.rbac, req.user);
    if (!a.isHr) throw new ForbiddenException('Only HR can do this');
    return { reminders: await this.reminders.runFor(req.user.organizationId) };
  }
}
