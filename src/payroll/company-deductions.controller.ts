import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { CompanyDeductionsService } from './company-deductions.service';
import { CreateCompanyDeductionDto, UpdateCompanyDeductionDto } from './dto/company-deduction.dto';

// Settings → Payroll deductions.
@Controller('payroll-deductions')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CompanyDeductionsController {
  constructor(private deductions: CompanyDeductionsService) {}

  @Get()
  @RequirePermission('hrm.payroll.read')
  list(@Req() req: any) {
    return this.deductions.list(req.user.organizationId);
  }

  @Post()
  @RequirePermission('hrm.payroll.write')
  create(@Req() req: any, @Body() dto: CreateCompanyDeductionDto) {
    return this.deductions.create(req.user.organizationId, req.user.id, dto);
  }

  @Patch(':id')
  @RequirePermission('hrm.payroll.write')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCompanyDeductionDto) {
    return this.deductions.update(req.user.organizationId, req.user.id, id, dto);
  }

  @Delete(':id')
  @RequirePermission('hrm.payroll.write')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.deductions.remove(req.user.organizationId, req.user.id, id);
  }
}
