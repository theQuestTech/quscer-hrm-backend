import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { AttendanceService } from './attendance.service';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';

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

  // Admin/manager marking someone else's attendance — WBS 3.3's full
  // "manual attendance and manager correction workflow" is more than this
  // (approval trail, reason codes); this is the raw write path it builds on.
  @Post('mark')
  @RequirePermission('hrm.attendance.approve')
  markManual(@Req() req: any, @Body() dto: MarkAttendanceDto) {
    return this.attendanceService.markManual(
      req.user.organizationId,
      dto.employeeId,
      dto.date,
      dto.status,
      dto.notes,
    );
  }

  @Get()
  @RequirePermission('hrm.attendance.read')
  history(@Req() req: any, @Query() query: QueryAttendanceDto) {
    if (query.employeeId) {
      return this.attendanceService.findHistory(
        req.user.organizationId,
        query.employeeId,
        query.from,
        query.to,
      );
    }
    // No employeeId given — default to the caller's own history.
    return this.attendanceService.findHistoryForCaller(
      req.user.organizationId,
      req.user.id,
      query.from,
      query.to,
    );
  }
}
