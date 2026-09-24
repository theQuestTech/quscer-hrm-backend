import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { LeaveService } from './leave.service';
import {
  CreateLeaveTypeDto,
  CreateLeaveRequestDto,
  QueryLeaveBalancesDto,
  QueryLeaveRequestsDto,
  SetLeaveAllocationDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';

@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LeaveController {
  constructor(private leaveService: LeaveService) {}

  @Post('leave-types')
  @RequirePermission('hrm.settings.write')
  createLeaveType(@Req() req: any, @Body() dto: CreateLeaveTypeDto) {
    return this.leaveService.createLeaveType(req.user.organizationId, dto);
  }

  @Patch('leave-types/:id')
  @RequirePermission('hrm.settings.write')
  updateLeaveType(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.leaveService.updateLeaveType(req.user.organizationId, id, dto);
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

  // Without hrm.leave.approve this only ever returns the caller's own requests.
  @Get('leave-requests')
  @RequirePermission('hrm.leave.read')
  listRequests(@Req() req: any, @Query() query: QueryLeaveRequestsDto) {
    return this.leaveService.listRequests(req.user.organizationId, req.user, query.employeeId, query.status);
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

  @Patch('leave-requests/:id/cancel')
  @RequirePermission('hrm.leave.read')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.leaveService.cancel(req.user.organizationId, req.user, id);
  }

  @Get('leave-balances')
  @RequirePermission('hrm.leave.read')
  balances(@Req() req: any, @Query() query: QueryLeaveBalancesDto) {
    return this.leaveService.balances(req.user.organizationId, req.user, query.employeeId, query.year);
  }

  @Put('leave-balances')
  @RequirePermission('hrm.leave.approve')
  setAllocation(@Req() req: any, @Body() dto: SetLeaveAllocationDto) {
    return this.leaveService.setAllocation(req.user.organizationId, req.user.id, dto);
  }
}
