import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [LeaveController],
  providers: [LeaveService],
})
export class LeaveModule {}
