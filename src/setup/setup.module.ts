import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [SetupController],
  providers: [SetupService],
  exports: [SetupService],
})
export class SetupModule {}
