import { Controller, Get } from '@nestjs/common';
import { quscerEnv } from './environment';

/** Public: which copy this is, so the app can show the STAGING badge. Nothing secret. */
@Controller('environment')
export class EnvironmentController {
  @Get()
  get() {
    return { environment: quscerEnv() };
  }
}
