import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { EmployeesModule } from '../employees/employees.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { CareersController, RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';

@Module({
  imports: [AuthModule, RbacModule, EmployeesModule, OnboardingModule],
  controllers: [RecruitmentController, CareersController],
  providers: [RecruitmentService],
})
export class RecruitmentModule {}
