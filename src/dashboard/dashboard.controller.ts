import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  // HR only (checked in the service: editing employees or settings).
  @Get('summary')
  @RequirePermission('hrm.employee.read')
  summary(@Req() req: any) {
    return this.dashboard.summary(req.user);
  }

  // A manager's direct reports.
  @Get('team')
  @RequirePermission('hrm.leave.approve')
  team(@Req() req: any) {
    return this.dashboard.team(req.user);
  }

  // Anyone in the company: their own recent activity.
  @Get('me')
  me(@Req() req: any) {
    return this.dashboard.me(req.user);
  }

  // Outsourced HR: one card per company they can do HR work in.
  @Get('companies')
  companies(@Req() req: any) {
    return this.dashboard.companies(req.user.id);
  }
}
