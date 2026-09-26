import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerformanceService } from './performance.service';
import { CycleDto, KpiTemplateDto, LaunchCycleDto, RateDto, SetGoalsDto } from './performance.dto';
import { PartialType } from '@nestjs/mapped-types';

class UpdateKpiTemplateDto extends PartialType(KpiTemplateDto) {}

// Who may do what is decided in PerformanceService (HR / manager / self).
@Controller('performance')
@UseGuards(JwtAuthGuard)
export class PerformanceController {
  constructor(private perf: PerformanceService) {}

  @Get('kpis')
  listKpis(@Req() req: any) {
    return this.perf.listKpis(req.user);
  }

  @Post('kpis')
  createKpi(@Req() req: any, @Body() dto: KpiTemplateDto) {
    return this.perf.createKpi(req.user, dto);
  }

  @Patch('kpis/:id')
  updateKpi(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateKpiTemplateDto) {
    return this.perf.updateKpi(req.user, id, dto);
  }

  @Get('cycles')
  listCycles(@Req() req: any) {
    return this.perf.listCycles(req.user);
  }

  @Post('cycles')
  createCycle(@Req() req: any, @Body() dto: CycleDto) {
    return this.perf.createCycle(req.user, dto);
  }

  @Get('cycles/:id')
  getCycle(@Req() req: any, @Param('id') id: string) {
    return this.perf.getCycle(req.user, id);
  }

  @Post('cycles/:id/launch')
  launch(@Req() req: any, @Param('id') id: string, @Body() dto: LaunchCycleDto) {
    return this.perf.launchCycle(req.user, id, dto);
  }

  @Post('cycles/:id/close')
  close(@Req() req: any, @Param('id') id: string) {
    return this.perf.closeCycle(req.user, id);
  }

  @Delete('cycles/:id')
  deleteCycle(@Req() req: any, @Param('id') id: string) {
    return this.perf.deleteCycle(req.user, id);
  }

  @Get('reviews')
  listReviews(@Req() req: any, @Query('scope') scope?: string) {
    return this.perf.listReviews(req.user, scope === 'team' ? 'team' : 'mine');
  }

  @Get('reviews/:id')
  getReview(@Req() req: any, @Param('id') id: string) {
    return this.perf.getReview(req.user, id);
  }

  @Put('reviews/:id/goals')
  setGoals(@Req() req: any, @Param('id') id: string, @Body() dto: SetGoalsDto) {
    return this.perf.setGoals(req.user, id, dto);
  }

  @Post('reviews/:id/share')
  share(@Req() req: any, @Param('id') id: string) {
    return this.perf.shareGoals(req.user, id);
  }

  @Patch('reviews/:id/self')
  saveSelf(@Req() req: any, @Param('id') id: string, @Body() dto: RateDto) {
    return this.perf.saveSelf(req.user, id, dto, false);
  }

  @Post('reviews/:id/self/submit')
  submitSelf(@Req() req: any, @Param('id') id: string, @Body() dto: RateDto) {
    return this.perf.saveSelf(req.user, id, dto, true);
  }

  @Patch('reviews/:id/manager')
  saveManager(@Req() req: any, @Param('id') id: string, @Body() dto: RateDto) {
    return this.perf.saveManager(req.user, id, dto, false);
  }

  @Post('reviews/:id/complete')
  complete(@Req() req: any, @Param('id') id: string, @Body() dto: RateDto) {
    return this.perf.saveManager(req.user, id, dto, true);
  }

  @Post('reviews/:id/acknowledge')
  acknowledge(@Req() req: any, @Param('id') id: string) {
    return this.perf.acknowledge(req.user, id);
  }
}
