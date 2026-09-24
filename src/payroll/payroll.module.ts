import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { StatutoryEngineService } from './statutory-engine.service';
import { PayslipPdfService } from './payslip-pdf.service';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [PayrollController],
  providers: [PayrollService, StatutoryEngineService, PayslipPdfService],
  exports: [StatutoryEngineService], // Phase 6 accounting-journal work will likely need this too
})
export class PayrollModule {}
