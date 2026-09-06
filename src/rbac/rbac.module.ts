import { Module } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { RbacService } from './rbac.service';

@Module({
  providers: [PermissionGuard, RbacService],
  exports: [PermissionGuard, RbacService],
})
export class RbacModule {}
