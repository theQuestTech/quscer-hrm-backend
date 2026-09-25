import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { SetupService } from './setup.service';
import {
  CreateBranchDto,
  CreateCostCentreDto,
  CreateDepartmentDto,
  CreateHolidayDto,
  CreateShiftDto,
  QueryHolidaysDto,
  UpdateBranchDto,
  UpdateCostCentreDto,
  UpdateDepartmentDto,
  UpdateOrganizationSettingsDto,
  UpdateShiftDto,
} from './dto/setup.dto';

// Reads use hrm.employee.read (they feed the employee form's dropdowns);
// every write is an org-settings change and needs hrm.settings.write.
@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class SetupController {
  constructor(private setupService: SetupService) {}

  @Get('settings')
  @RequirePermission('hrm.settings.write')
  getSettings(@Req() req: any) {
    return this.setupService.getSettings(req.user.organizationId);
  }

  @Patch('settings')
  @RequirePermission('hrm.settings.write')
  updateSettings(@Req() req: any, @Body() dto: UpdateOrganizationSettingsDto) {
    return this.setupService.updateSettings(req.user.organizationId, dto);
  }

  // --- Branches
  @Get('branches')
  @RequirePermission('hrm.employee.read')
  listBranches(@Req() req: any) {
    return this.setupService.listBranches(req.user.organizationId);
  }

  @Post('branches')
  @RequirePermission('hrm.settings.write')
  createBranch(@Req() req: any, @Body() dto: CreateBranchDto) {
    return this.setupService.createBranch(req.user.organizationId, dto);
  }

  @Patch('branches/:id')
  @RequirePermission('hrm.settings.write')
  updateBranch(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.setupService.updateBranch(req.user.organizationId, id, dto);
  }

  @Delete('branches/:id')
  @RequirePermission('hrm.settings.write')
  deleteBranch(@Req() req: any, @Param('id') id: string) {
    return this.setupService.deleteBranch(req.user.organizationId, id);
  }

  // --- Departments
  @Get('departments')
  @RequirePermission('hrm.employee.read')
  listDepartments(@Req() req: any) {
    return this.setupService.listDepartments(req.user.organizationId);
  }

  @Post('departments')
  @RequirePermission('hrm.settings.write')
  createDepartment(@Req() req: any, @Body() dto: CreateDepartmentDto) {
    return this.setupService.createDepartment(req.user.organizationId, dto);
  }

  @Patch('departments/:id')
  @RequirePermission('hrm.settings.write')
  updateDepartment(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.setupService.updateDepartment(req.user.organizationId, id, dto);
  }

  @Delete('departments/:id')
  @RequirePermission('hrm.settings.write')
  deleteDepartment(@Req() req: any, @Param('id') id: string) {
    return this.setupService.deleteDepartment(req.user.organizationId, id);
  }

  // --- Cost centres
  @Get('cost-centres')
  @RequirePermission('hrm.employee.read')
  listCostCentres(@Req() req: any) {
    return this.setupService.listCostCentres(req.user.organizationId);
  }

  @Post('cost-centres')
  @RequirePermission('hrm.settings.write')
  createCostCentre(@Req() req: any, @Body() dto: CreateCostCentreDto) {
    return this.setupService.createCostCentre(req.user.organizationId, dto);
  }

  @Patch('cost-centres/:id')
  @RequirePermission('hrm.settings.write')
  updateCostCentre(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCostCentreDto) {
    return this.setupService.updateCostCentre(req.user.organizationId, id, dto);
  }

  @Delete('cost-centres/:id')
  @RequirePermission('hrm.settings.write')
  deleteCostCentre(@Req() req: any, @Param('id') id: string) {
    return this.setupService.deleteCostCentre(req.user.organizationId, id);
  }

  // --- Shifts
  @Get('shifts')
  @RequirePermission('hrm.attendance.read')
  listShifts(@Req() req: any) {
    return this.setupService.listShifts(req.user.organizationId);
  }

  @Post('shifts')
  @RequirePermission('hrm.settings.write')
  createShift(@Req() req: any, @Body() dto: CreateShiftDto) {
    return this.setupService.createShift(req.user.organizationId, dto);
  }

  @Patch('shifts/:id')
  @RequirePermission('hrm.settings.write')
  updateShift(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateShiftDto) {
    return this.setupService.updateShift(req.user.organizationId, id, dto);
  }

  @Delete('shifts/:id')
  @RequirePermission('hrm.settings.write')
  deleteShift(@Req() req: any, @Param('id') id: string) {
    return this.setupService.deleteShift(req.user.organizationId, id);
  }

  // --- Holidays (readable by anyone who can request leave)
  @Get('holidays')
  @RequirePermission('hrm.leave.read')
  listHolidays(@Req() req: any, @Query() query: QueryHolidaysDto) {
    return this.setupService.listHolidays(req.user.organizationId, query.from, query.to);
  }

  @Post('holidays')
  @RequirePermission('hrm.settings.write')
  createHoliday(@Req() req: any, @Body() dto: CreateHolidayDto) {
    return this.setupService.createHoliday(req.user.organizationId, dto);
  }

  @Delete('holidays/:id')
  @RequirePermission('hrm.settings.write')
  deleteHoliday(@Req() req: any, @Param('id') id: string) {
    return this.setupService.deleteHoliday(req.user.organizationId, id);
  }
}
