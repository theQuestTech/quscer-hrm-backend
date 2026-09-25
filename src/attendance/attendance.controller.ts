import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { AttendanceService } from './attendance.service';
import { MarkAttendanceDto, QueryCorrectionsDto, RequestCorrectionDto } from './dto/mark-attendance.dto';
import { QueryAttendanceDto, QueryRegisterDto } from './dto/query-attendance.dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  // Self-service — no special permission beyond being logged in with a
  // linked Employee record, since every employee should be able to check
  // in/out for themselves.
  @Post('check-in')
  @RequirePermission('hrm.attendance.read')
  checkIn(@Req() req: any) {
    return this.attendanceService.checkIn(req.user.organizationId, req.user.id);
  }

  @Post('check-out')
  @RequirePermission('hrm.attendance.read')
  checkOut(@Req() req: any) {
    return this.attendanceService.checkOut(req.user.organizationId, req.user.id);
  }

  @Get('today')
  @RequirePermission('hrm.attendance.read')
  today(@Req() req: any) {
    return this.attendanceService.today(req.user.organizationId, req.user.id);
  }

  // Admin/manager marking someone else's attendance — WBS 3.3's full
  // "manual attendance and manager correction workflow" is more than this
  // (approval trail, reason codes); this is the raw write path it builds on.
  @Post('mark')
  @RequirePermission('hrm.attendance.approve')
  markManual(@Req() req: any, @Body() dto: MarkAttendanceDto) {
    return this.attendanceService.markManual(
      req.user.organizationId,
      req.user.id,
      dto.employeeId,
      dto.date,
      dto.status,
      dto.notes,
    );
  }

  @Get('register')
  @RequirePermission('hrm.attendance.approve')
  register(@Req() req: any, @Query() query: QueryRegisterDto) {
    return this.attendanceService.register(req.user.organizationId, query.date);
  }

  // Employees ask for their own times to be fixed.
  @Post('corrections')
  @RequirePermission('hrm.attendance.read')
  requestCorrection(@Req() req: any, @Body() dto: RequestCorrectionDto) {
    return this.attendanceService.requestCorrection(req.user.organizationId, req.user.id, dto);
  }

  // Without hrm.attendance.approve this only returns the caller's own.
  @Get('corrections')
  @RequirePermission('hrm.attendance.read')
  listCorrections(@Req() req: any, @Query() query: QueryCorrectionsDto) {
    return this.attendanceService.listCorrections(req.user.organizationId, req.user, query.status);
  }

  @Patch('corrections/:id/approve')
  @RequirePermission('hrm.attendance.approve')
  approveCorrection(@Req() req: any, @Param('id') id: string) {
    return this.attendanceService.decideCorrection(req.user.organizationId, req.user.id, id, true);
  }

  @Patch('corrections/:id/reject')
  @RequirePermission('hrm.attendance.approve')
  rejectCorrection(@Req() req: any, @Param('id') id: string) {
    return this.attendanceService.decideCorrection(req.user.organizationId, req.user.id, id, false);
  }

  // No employeeId = the caller's own history. Someone else's needs
  // hrm.attendance.approve (checked in the service).
  @Get()
  @RequirePermission('hrm.attendance.read')
  history(@Req() req: any, @Query() query: QueryAttendanceDto) {
    return this.attendanceService.history(
      req.user.organizationId,
      req.user,
      query.employeeId,
      query.from,
      query.to,
    );
  }
}
