import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { StatutoryEngineService } from './statutory-engine.service';
import { PayslipPdfService } from './payslip-pdf.service';
import { SettlementService } from './settlement.service';
import { CompanyDeductionsController } from './company-deductions.controller';
import { CompanyDeductionsService } from './company-deductions.service';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [PayrollController, CompanyDeductionsController],
  providers: [PayrollService, StatutoryEngineService, PayslipPdfService, SettlementService, CompanyDeductionsService],
  exports: [StatutoryEngineService], // Phase 6 accounting-journal work will likely need this too
})
export class PayrollModule {}
