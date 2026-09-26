import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { PhotoController } from './photo.controller';
import { MeController } from './me.controller';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [EmployeesController, PhotoController, MeController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
