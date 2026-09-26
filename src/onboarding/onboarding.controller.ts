import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingService } from './onboarding.service';
import { DoneDto, TaskDto, TemplateDto } from './onboarding.dto';

class UpdateTemplateDto extends PartialType(TemplateDto) {}

// Who may do what is decided in OnboardingService (HR / manager / self).
@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private onboarding: OnboardingService) {}

  @Get('templates')
  listTemplates(@Req() req: any) {
    return this.onboarding.listTemplates(req.user);
  }

  @Post('templates')
  createTemplate(@Req() req: any, @Body() dto: TemplateDto) {
    return this.onboarding.createTemplate(req.user, dto);
  }

  @Post('templates/suggested')
  addSuggested(@Req() req: any) {
    return this.onboarding.addSuggested(req.user);
  }

  @Patch('templates/:id')
  updateTemplate(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.onboarding.updateTemplate(req.user, id, dto);
  }

  @Delete('templates/:id')
  removeTemplate(@Req() req: any, @Param('id') id: string) {
    return this.onboarding.removeTemplate(req.user, id);
  }

  @Get()
  overview(@Req() req: any) {
    return this.onboarding.overview(req.user);
  }

  @Get('mine')
  mine(@Req() req: any) {
    return this.onboarding.mine(req.user);
  }

  @Get('employees/:employeeId')
  forEmployee(@Req() req: any, @Param('employeeId') employeeId: string) {
    return this.onboarding.forEmployee(req.user, employeeId);
  }

  @Post('employees/:employeeId/start')
  start(@Req() req: any, @Param('employeeId') employeeId: string) {
    return this.onboarding.start(req.user, employeeId);
  }

  @Post('tasks')
  addTask(@Req() req: any, @Body() dto: TaskDto) {
    return this.onboarding.addTask(req.user, dto);
  }

  @Patch('tasks/:id')
  setDone(@Req() req: any, @Param('id') id: string, @Body() dto: DoneDto) {
    return this.onboarding.setDone(req.user, id, dto.done);
  }

  @Delete('tasks/:id')
  removeTask(@Req() req: any, @Param('id') id: string) {
    return this.onboarding.removeTask(req.user, id);
  }
}
