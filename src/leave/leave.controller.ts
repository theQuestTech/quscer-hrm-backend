import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { LeaveService } from './leave.service';
import { CreateLeaveTypeDto, CreateLeaveRequestDto, QueryLeaveRequestsDto } from './dto/leave.dto';

@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LeaveController {
  constructor(private leaveService: LeaveService) {}

  @Post('leave-types')
  @RequirePermission('hrm.settings.write')
  createLeaveType(@Req() req: any, @Body() dto: CreateLeaveTypeDto) {
    return this.leaveService.createLeaveType(req.user.organizationId, dto);
  }

  @Get('leave-types')
  @RequirePermission('hrm.leave.read')
  listLeaveTypes(@Req() req: any) {
    return this.leaveService.listLeaveTypes(req.user.organizationId);
  }

  @Post('leave-requests')
  @RequirePermission('hrm.leave.read') // any employee with base leave access can request their own
  createRequest(@Req() req: any, @Body() dto: CreateLeaveRequestDto) {
    return this.leaveService.createRequest(req.user.organizationId, req.user.id, dto);
  }

  @Get('leave-requests')
  @RequirePermission('hrm.leave.read')
  listRequests(@Req() req: any, @Query() query: QueryLeaveRequestsDto) {
    return this.leaveService.listRequests(req.user.organizationId, query.employeeId, query.status);
  }

  @Patch('leave-requests/:id/approve')
  @RequirePermission('hrm.leave.approve')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.leaveService.decide(req.user.organizationId, req.user.id, id, true);
  }

  @Patch('leave-requests/:id/reject')
  @RequirePermission('hrm.leave.approve')
  reject(@Req() req: any, @Param('id') id: string) {
    return this.leaveService.decide(req.user.organizationId, req.user.id, id, false);
  }
}
