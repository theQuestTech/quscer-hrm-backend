import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { AdmsController } from './adms.controller';
import { CheckInRulesService } from './checkin-rules.service';
import { DevicesController, PunchApiController } from './devices.controller';
import { DevicesService } from './devices.service';
import { PunchService } from './punch.service';

@Module({
  imports: [AuthModule, RbacModule],
  // PunchApiController first so "punches" isn't read as a device id.
  controllers: [PunchApiController, AdmsController, DevicesController],
  providers: [DevicesService, PunchService, CheckInRulesService],
  exports: [PunchService, CheckInRulesService],
})
export class AttendanceDevicesModule {}
