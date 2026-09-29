import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ActivityService } from './activity.service';

@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private activity: ActivityService) {}

  @Get()
  list(
    @Req() req: any,
    @Query('area') area?: string,
    @Query('actor') actor?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.activity.list(req.user, { area, actor, from, to }, cursor);
  }

  @Get('verify')
  verify(@Req() req: any) {
    return this.activity.verify(req.user);
  }

  @Get('people')
  people(@Req() req: any) {
    return this.activity.people(req.user);
  }

  @Get('export')
  async export(
    @Req() req: any,
    @Res() res: Response,
    @Query('area') area?: string,
    @Query('actor') actor?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.activity.csv(req.user, { area, actor, from, to });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="activity-history.csv"');
    res.send('﻿' + csv); // BOM so Excel reads Urdu names and dashes correctly
  }
}
