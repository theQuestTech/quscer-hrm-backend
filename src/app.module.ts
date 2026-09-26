import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RbacModule } from './rbac/rbac.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { EmployeesModule } from './employees/employees.module';
import { AttendanceModule } from './attendance/attendance.module';
import { LeaveModule } from './leave/leave.module';
import { PayrollModule } from './payroll/payroll.module';
import { CryptoModule } from './crypto/crypto.module';
import { SetupModule } from './setup/setup.module';
import { UsersModule } from './users/users.module';
import { FeedModule } from './feed/feed.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PerformanceModule } from './performance/performance.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { RecruitmentModule } from './recruitment/recruitment.module';
import { TrainingModule } from './training/training.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CryptoModule,
    AuthModule,
    RbacModule,
    OrganizationsModule,
    EmployeesModule,
    AttendanceModule,
    LeaveModule,
    PayrollModule,
    SetupModule,
    UsersModule,
    FeedModule,
    DashboardModule,
    PerformanceModule,
    OnboardingModule,
    RecruitmentModule,
    TrainingModule,
  ],
})
export class AppModule {}
