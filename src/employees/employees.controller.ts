import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { CreateEmergencyContactDto } from './dto/create-emergency-contact.dto';
import { CreateEmployeeDocumentDto } from './dto/create-employee-document.dto';
import { UpsertBankDetailDto } from './dto/upsert-bank-detail.dto';

@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  @Post()
  @RequirePermission('hrm.employee.write')
  create(@Req() req: any, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(
      req.user.organizationId,
      req.user.id,
      dto,
    );
  }

  // WBS 2.12 — directory
  @Get()
  @RequirePermission('hrm.employee.read')
  findAll(@Req() req: any, @Query() query: QueryEmployeesDto) {
    return this.employeesService.findAll(req.user.organizationId, query);
  }

  @Get(':id')
  @RequirePermission('hrm.employee.read')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.employeesService.findOne(req.user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission('hrm.employee.write')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(
      req.user.organizationId,
      req.user.id,
      id,
      dto,
    );
  }

  // WBS 2.6 — one level of direct reports for an org-chart view
  @Get(':id/direct-reports')
  @RequirePermission('hrm.employee.read')
  getDirectReports(@Req() req: any, @Param('id') id: string) {
    return this.employeesService.getDirectReports(req.user.organizationId, id);
  }

  // WBS 2.3 — emergency contacts
  @Post(':id/emergency-contacts')
  @RequirePermission('hrm.employee.write')
  addEmergencyContact(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CreateEmergencyContactDto,
  ) {
    return this.employeesService.addEmergencyContact(req.user.organizationId, id, dto);
  }

  @Delete(':id/emergency-contacts/:contactId')
  @RequirePermission('hrm.employee.write')
  removeEmergencyContact(
    @Req() req: any,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ) {
    return this.employeesService.removeEmergencyContact(req.user.organizationId, id, contactId);
  }

  // WBS 2.5 — documents
  @Post(':id/documents')
  @RequirePermission('hrm.employee.write')
  addDocument(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CreateEmployeeDocumentDto,
  ) {
    return this.employeesService.addDocument(req.user.organizationId, id, dto);
  }

  @Delete(':id/documents/:documentId')
  @RequirePermission('hrm.employee.write')
  removeDocument(
    @Req() req: any,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.employeesService.removeDocument(req.user.organizationId, id, documentId);
  }

  // WBS 2.3 — bank details (one per employee, upsert)
  @Put(':id/bank-detail')
  @RequirePermission('hrm.employee.write')
  upsertBankDetail(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpsertBankDetailDto,
  ) {
    return this.employeesService.upsertBankDetail(req.user.organizationId, id, dto);
  }
}
