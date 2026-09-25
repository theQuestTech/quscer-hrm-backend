import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { PayrollService } from './payroll.service';
import { PayslipPdfService } from './payslip-pdf.service';
import { UpsertSalaryStructureDto, CreatePayrollRunDto, CreateLoanDto, UpsertFinalSettlementDto } from './dto/payroll.dto';
import { SettlementService } from './settlement.service';

@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PayrollController {
  constructor(
    private payrollService: PayrollService,
    private payslipPdfService: PayslipPdfService,
    private settlementService: SettlementService,
  ) {}

  // --- WBS 4.14 — final settlement -------------------------------------
  // Same maker/checker split as payroll runs: payroll.run drafts,
  // payroll.approve approves and marks it paid.

  @Get('employees/:id/final-settlement')
  @RequirePermission('hrm.payroll.read')
  getSettlement(@Req() req: any, @Param('id') employeeId: string) {
    return this.settlementService.get(req.user.organizationId, employeeId);
  }

  @Post('employees/:id/final-settlement')
  @RequirePermission('hrm.payroll.run')
  upsertSettlement(@Req() req: any, @Param('id') employeeId: string, @Body() dto: UpsertFinalSettlementDto) {
    return this.settlementService.upsertDraft(req.user.organizationId, req.user.id, employeeId, dto);
  }

  @Patch('final-settlements/:id/approve')
  @RequirePermission('hrm.payroll.approve')
  approveSettlement(@Req() req: any, @Param('id') id: string) {
    return this.settlementService.approve(req.user.organizationId, req.user.id, id);
  }

  @Patch('final-settlements/:id/mark-paid')
  @RequirePermission('hrm.payroll.approve')
  markSettlementPaid(@Req() req: any, @Param('id') id: string) {
    return this.settlementService.markPaid(req.user.organizationId, req.user.id, id);
  }

  @Delete('final-settlements/:id')
  @RequirePermission('hrm.payroll.run')
  deleteSettlement(@Req() req: any, @Param('id') id: string) {
    return this.settlementService.remove(req.user.organizationId, req.user.id, id);
  }

  @Get('final-settlements/:id/pdf')
  @RequirePermission('hrm.payroll.read')
  async settlementPdf(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const data = await this.settlementService.pdfData(req.user.organizationId, id);
    const pdf = await this.payslipPdfService.generateSettlement(data);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="final-settlement-${data.employeeNumber.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf"`,
    });
    res.send(pdf);
  }

  @Post('employees/:id/salary-structure')
  @RequirePermission('hrm.payroll.write')
  upsertSalaryStructure(
    @Req() req: any,
    @Param('id') employeeId: string,
    @Body() dto: UpsertSalaryStructureDto,
  ) {
    return this.payrollService.upsertSalaryStructure(req.user.organizationId, employeeId, dto);
  }

  @Get('employees/:id/salary-structure')
  @RequirePermission('hrm.payroll.read')
  getSalaryStructure(@Req() req: any, @Param('id') employeeId: string) {
    return this.payrollService.getSalaryStructure(req.user.organizationId, employeeId);
  }

  // WBS 4.1/4.6/4.7 — creates a run and immediately calculates it (DRAFT).
  // "hrm.payroll.run" is the MAKER permission — deliberately distinct from
  // "hrm.payroll.approve" below, so one person can't do both by default.
  @Post('payroll-runs')
  @RequirePermission('hrm.payroll.run')
  createRun(@Req() req: any, @Body() dto: CreatePayrollRunDto) {
    return this.payrollService.createRun(req.user.organizationId, req.user.id, dto);
  }

  @Post('payroll-runs/:id/recalculate')
  @RequirePermission('hrm.payroll.run')
  recalculate(@Req() req: any, @Param('id') id: string) {
    return this.payrollService.calculate(req.user.organizationId, id);
  }

  @Post('payroll-runs/:id/submit')
  @RequirePermission('hrm.payroll.run')
  submit(@Req() req: any, @Param('id') id: string) {
    return this.payrollService.submit(req.user.organizationId, req.user.id, id);
  }

  // WBS 4.9 — the CHECKER step. Requires "hrm.payroll.approve", not
  // "hrm.payroll.run" — see the RBAC seed data, these are separate roles
  // by default ("Payroll Approver" has both, but doesn't have to).
  @Post('payroll-runs/:id/approve')
  @RequirePermission('hrm.payroll.approve')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.payrollService.approve(req.user.organizationId, req.user.id, id);
  }

  @Post('payroll-runs/:id/lock')
  @RequirePermission('hrm.payroll.approve')
  lock(@Req() req: any, @Param('id') id: string) {
    return this.payrollService.lock(req.user.organizationId, req.user.id, id);
  }

  @Delete('payroll-runs/:id')
  @RequirePermission('hrm.payroll.run')
  deleteDraft(@Req() req: any, @Param('id') id: string) {
    return this.payrollService.deleteDraft(req.user.organizationId, req.user.id, id);
  }

  // WBS 4.11 — CSV for the bank's bulk-transfer upload. Contains full account
  // numbers, so it needs the approver permission, not just payroll.read.
  // Employee numbers left out (no bank details) come back in a header.
  @Get('payroll-runs/:id/bank-file')
  @RequirePermission('hrm.payroll.approve')
  async bankFile(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const { csv, filename, missingBankDetails } = await this.payrollService.bankFile(
      req.user.organizationId, req.user.id, id,
    );
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Missing-Bank-Details': missingBankDetails.join(','),
      'Cache-Control': 'no-store',
    });
    res.send(csv);
  }

  // Self-service list of the caller's own approved payslips — like
  // my-payslip below, no payroll permission needed for your own pay.
  @Get('my-payslips')
  myPayslips(@Req() req: any) {
    return this.payrollService.myPayslips(req.user.organizationId, req.user.id);
  }

  @Get('payroll-runs')
  @RequirePermission('hrm.payroll.read')
  listRuns(@Req() req: any) {
    return this.payrollService.listRuns(req.user.organizationId);
  }

  @Get('payroll-runs/:id')
  @RequirePermission('hrm.payroll.read')
  getRun(@Req() req: any, @Param('id') id: string) {
    return this.payrollService.getRunWithLineItems(req.user.organizationId, id);
  }

  // WBS 4.12 — loans
  @Post('employees/:id/loans')
  @RequirePermission('hrm.payroll.write')
  createLoan(@Req() req: any, @Param('id') employeeId: string, @Body() dto: CreateLoanDto) {
    return this.payrollService.createLoan(req.user.organizationId, employeeId, dto);
  }

  @Get('employees/:id/loans')
  @RequirePermission('hrm.payroll.read')
  listLoans(@Req() req: any, @Param('id') employeeId: string) {
    return this.payrollService.listLoans(req.user.organizationId, employeeId);
  }

  // WBS 4.10 — payslip PDFs.

  // Self-service — any employee can pull their own payslip once a run is
  // approved. No @RequirePermission here on purpose: viewing your OWN
  // payslip isn't a payroll-admin action, and requiring hrm.payroll.read
  // would mean only HR could see their own pay stub. JwtAuthGuard alone
  // (still applied at the controller level) is enough — the handler itself
  // enforces "own record only" via resolveEmployeeForUser.
  @Get('payroll-runs/:id/my-payslip')
  async getMyPayslip(@Req() req: any, @Param('id') runId: string, @Res() res: Response) {
    const employee = await this.payrollService.resolveEmployeeForUser(
      req.user.organizationId, req.user.id,
    );
    return this.streamPayslip(req.user.organizationId, runId, employee.id, res);
  }

  @Get('payroll-runs/:id/employees/:employeeId/payslip')
  @RequirePermission('hrm.payroll.read')
  async getEmployeePayslip(
    @Req() req: any,
    @Param('id') runId: string,
    @Param('employeeId') employeeId: string,
    @Res() res: Response,
  ) {
    return this.streamPayslip(req.user.organizationId, runId, employeeId, res);
  }

  private async streamPayslip(organizationId: string, runId: string, employeeId: string, res: Response) {
    const { run, lineItem, organization } = await this.payrollService.getPayslipData(
      organizationId, runId, employeeId,
    );
    const pdfBuffer = await this.payslipPdfService.generate({
      organizationName: organization!.name,
      employeeName: `${lineItem.employee.firstName} ${lineItem.employee.lastName}`,
      employeeNumber: lineItem.employee.employeeNumber,
      designation: lineItem.employee.designation,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      payDate: run.payDate,
      currency: lineItem.currency,
      grossSalary: Number(lineItem.grossSalary),
      totalEarnings: Number(lineItem.totalEarnings),
      totalDeductions: Number(lineItem.totalDeductions),
      netSalary: Number(lineItem.netSalary),
      breakdown: lineItem.breakdown as any[],
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="payslip-${lineItem.employee.employeeNumber}.pdf"`,
    });
    res.send(pdfBuffer);
  }
}
