import { Body, Controller, Delete, Get, Headers, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { visitorAddress } from '../common/visitor-address';
import { RateLimiter } from '../recruitment/recruitment-rules';
import { DevicesService } from './devices.service';
import { DeviceDto, ImportDto, LinkDto, LocationDto, NetworkDto, PunchBatchDto, UpdateDeviceDto } from './devices.dto';

class UpdateLocationDto extends PartialType(LocationDto) {}

// HR's screens. Who may do what is checked in DevicesService (HR only).
@Controller('attendance-devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private devices: DevicesService) {}

  @Get()
  list(@Req() req: any) {
    return this.devices.list(req.user);
  }

  @Post()
  create(@Req() req: any, @Body() dto: DeviceDto) {
    return this.devices.create(req.user, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    return this.devices.update(req.user, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.devices.remove(req.user, id);
  }

  @Post(':id/new-key')
  newKey(@Req() req: any, @Param('id') id: string) {
    return this.devices.newKey(req.user, id);
  }

  @Post('import')
  importFile(@Req() req: any, @Body() dto: ImportDto) {
    const { deviceId, ...batch } = dto;
    return this.devices.importFile(req.user, deviceId, batch);
  }

  @Get('unmatched')
  unmatched(@Req() req: any) {
    return this.devices.unmatched(req.user);
  }

  @Post('unmatched/:machineUserId/link')
  link(@Req() req: any, @Param('machineUserId') machineUserId: string, @Body() dto: LinkDto) {
    return this.devices.link(req.user, machineUserId, dto.employeeId);
  }

  @Delete('unmatched/:machineUserId')
  discard(@Req() req: any, @Param('machineUserId') machineUserId: string) {
    return this.devices.discard(req.user, machineUserId);
  }

  @Get('networks')
  listNetworks(@Req() req: any) {
    return this.devices.listNetworks(req.user);
  }

  @Post('networks')
  addNetwork(@Req() req: any, @Body() dto: NetworkDto) {
    return this.devices.addNetwork(req.user, dto);
  }

  @Delete('networks/:id')
  removeNetwork(@Req() req: any, @Param('id') id: string) {
    return this.devices.removeNetwork(req.user, id);
  }

  // Where machines connect: the plain-HTTP address for older machines, if
  // the server has one (MACHINE_PUBLIC_ADDRESS, e.g. "x.proxy.rlwy.net:12345").
  @Get('connection-info')
  connectionInfo() {
    const plain = process.env.MACHINE_PUBLIC_ADDRESS?.trim();
    const [host, port] = plain ? plain.replace(/^https?:\/\//, '').split(':') : [];
    return { plainHttp: plain ? { host, port: port ? Number(port) : 80 } : null };
  }

  // "Use my current network": the internet address this request came from.
  @Get('my-ip')
  myIp(@Req() req: Request) {
    return { ip: visitorAddress(req) };
  }

  @Get('locations')
  listLocations(@Req() req: any) {
    return this.devices.listLocations(req.user);
  }

  @Post('locations')
  addLocation(@Req() req: any, @Body() dto: LocationDto) {
    return this.devices.addLocation(req.user, dto);
  }

  @Patch('locations/:id')
  updateLocation(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.devices.updateLocation(req.user, id, dto);
  }

  @Delete('locations/:id')
  removeLocation(@Req() req: any, @Param('id') id: string) {
    return this.devices.removeLocation(req.user, id);
  }
}

const perKey = new RateLimiter(120, 60 * 1000);

// Other systems sending punches: no login, a device key instead.
@Controller('attendance-devices/punches')
export class PunchApiController {
  constructor(private devices: DevicesService) {}

  @Post()
  @HttpCode(200)
  ingest(@Headers('x-device-key') key: string | undefined, @Req() req: Request, @Body() dto: PunchBatchDto) {
    if (!perKey.allow(key ?? visitorAddress(req))) {
      throw new HttpException('Too many requests — send punches in batches', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.devices.ingestWithKey(key, dto);
  }
}
