import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { AttendanceDevicesModule } from '../attendance-devices/devices.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { PhotoController } from './photo.controller';
import { MeController } from './me.controller';
import { BankChangesController } from './bank-changes.controller';
import { UsersModule } from '../users/users.module';
import { EmployeeImportService } from './employee-import.service';

@Module({
  imports: [AuthModule, RbacModule, AttendanceDevicesModule, UsersModule],
  controllers: [EmployeesController, PhotoController, MeController, BankChangesController],
  providers: [EmployeesService, EmployeeImportService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
