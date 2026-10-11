import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { EndVisitDto, PointsDto, RouteQueryDto, StartVisitDto, TrackingEventDto, TrackingSettingsDto } from './dto';
import { TrackingService } from './tracking.service';

// Field tracking add-on. Every route answers "not switched on" until Quscer
// support turns it on for the company (except /me, which the phone asks first).
@Controller('tracking')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class TrackingController {
  constructor(private tracking: TrackingService) {}

  // --- The field person's phone ---

  @Get('me')
  @RequirePermission('hrm.attendance.read')
  me(@Req() req: any) {
    return this.tracking.me(req.user.organizationId, req.user.id);
  }

  @Post('points')
  @HttpCode(200)
  @RequirePermission('hrm.attendance.read')
  points(@Req() req: any, @Body() dto: PointsDto) {
    return this.tracking.addPoints(req.user.organizationId, req.user.id, dto);
  }

  @Post('events')
  @HttpCode(200)
  @RequirePermission('hrm.attendance.read')
  event(@Req() req: any, @Body() dto: TrackingEventDto) {
    return this.tracking.addEvent(req.user.organizationId, req.user.id, dto);
  }

  @Post('visits')
  @RequirePermission('hrm.attendance.read')
  startVisit(@Req() req: any, @Body() dto: StartVisitDto) {
    return this.tracking.startVisit(req.user.organizationId, req.user.id, dto);
  }

  @Post('visits/:id/end')
  @HttpCode(200)
  @RequirePermission('hrm.attendance.read')
  endVisit(@Req() req: any, @Param('id') id: string, @Body() dto: EndVisitDto) {
    return this.tracking.endVisit(req.user.organizationId, req.user.id, id, dto);
  }

  // --- Managers (their team) and HR (everyone) ---

  @Get('live')
  @RequirePermission('hrm.attendance.approve')
  live(@Req() req: any) {
    return this.tracking.live(req.user.organizationId, req.user);
  }

  // Without employeeId: your own day. Someone else's needs attendance approval
  // and them being in your team.
  @Get('route')
  @RequirePermission('hrm.attendance.read')
  route(@Req() req: any, @Query() q: RouteQueryDto) {
    return this.tracking.route(req.user.organizationId, req.user, q.employeeId, q.date);
  }

  @Get('settings')
  @RequirePermission('hrm.attendance.approve')
  settings(@Req() req: any) {
    return this.tracking.getSettings(req.user.organizationId);
  }

  @Patch('settings')
  @RequirePermission('hrm.settings.write')
  updateSettings(@Req() req: any, @Body() dto: TrackingSettingsDto) {
    return this.tracking.updateSettings(req.user.organizationId, req.user.id, dto);
  }
}
