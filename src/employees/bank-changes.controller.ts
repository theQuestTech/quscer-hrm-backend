import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { EmployeesService } from './employees.service';

/** Salary bank account changes waiting for a second person. */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('bank-detail-changes')
export class BankChangesController {
  constructor(private employees: EmployeesService) {}

  @Get()
  @RequirePermission('hrm.employee.write')
  list(@Req() req: any, @Query('status') status?: string) {
    return this.employees.listBankChanges(req.user.organizationId, status);
  }

  /** Needs the approver's code in the X-Two-Step-Code header. */
  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('hrm.employee.write')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.employees.approveBankChange(req, id);
  }

  /** Turn down someone else's change, or cancel your own. */
  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('hrm.employee.write')
  reject(@Req() req: any, @Param('id') id: string, @Body('note') note?: string) {
    return this.employees.rejectBankChange(req, id, note);
  }
}
