import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TrainingService } from './training.service';
import {
  CompleteDto, CourseDto, DecideDto, EnrolDto, ExternalRecordDto, FeedbackDto, RequestDto, SessionDto, UpdateSessionDto,
} from './training.dto';

class UpdateCourseDto extends PartialType(CourseDto) {}

// Who may do what is decided in TrainingService (HR / manager / self).
@Controller('training')
@UseGuards(JwtAuthGuard)
export class TrainingController {
  constructor(private training: TrainingService) {}

  @Get('courses')
  listCourses(@Req() req: any) {
    return this.training.listCourses(req.user);
  }

  @Post('courses')
  createCourse(@Req() req: any, @Body() dto: CourseDto) {
    return this.training.createCourse(req.user, dto);
  }

  @Patch('courses/:id')
  updateCourse(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.training.updateCourse(req.user, id, dto);
  }

  @Get('sessions')
  listSessions(@Req() req: any, @Query('when') when?: string) {
    return this.training.listSessions(req.user, when === 'past' ? 'past' : 'upcoming');
  }

  @Post('sessions')
  createSession(@Req() req: any, @Body() dto: SessionDto) {
    return this.training.createSession(req.user, dto);
  }

  @Get('sessions/:id')
  getSession(@Req() req: any, @Param('id') id: string) {
    return this.training.getSession(req.user, id);
  }

  @Patch('sessions/:id')
  updateSession(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateSessionDto) {
    return this.training.updateSession(req.user, id, dto);
  }

  @Post('sessions/:id/enrol')
  enrol(@Req() req: any, @Param('id') id: string, @Body() dto: EnrolDto) {
    return this.training.enrol(req.user, id, dto);
  }

  @Post('sessions/:id/complete')
  complete(@Req() req: any, @Param('id') id: string, @Body() dto: CompleteDto) {
    return this.training.complete(req.user, id, dto);
  }

  @Delete('enrolments/:id')
  removeEnrolment(@Req() req: any, @Param('id') id: string) {
    return this.training.removeEnrolment(req.user, id);
  }

  @Post('enrolments/:id/feedback')
  feedback(@Req() req: any, @Param('id') id: string, @Body() dto: FeedbackDto) {
    return this.training.feedback(req.user, id, dto);
  }

  @Get('enrolments/:id/certificate')
  async certificate(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const file = await this.training.certificate(req.user, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(file.data);
  }

  @Post('records')
  recordExternal(@Req() req: any, @Body() dto: ExternalRecordDto) {
    return this.training.recordExternal(req.user, dto);
  }

  @Get('mine')
  mine(@Req() req: any) {
    return this.training.mine(req.user);
  }

  @Get('employees/:id')
  forEmployee(@Req() req: any, @Param('id') id: string) {
    return this.training.forEmployee(req.user, id);
  }

  @Get('certificates/expiring')
  expiring(@Req() req: any) {
    return this.training.expiring(req.user);
  }

  @Get('report')
  report(@Req() req: any, @Query('year') year?: string) {
    const y = Number(year);
    return this.training.report(req.user, Number.isInteger(y) && y > 2000 && y < 2100 ? y : new Date().getUTCFullYear());
  }

  @Get('requests')
  listRequests(@Req() req: any, @Query('scope') scope?: string) {
    return this.training.listRequests(req.user, scope === 'team' ? 'team' : 'mine');
  }

  @Post('requests')
  createRequest(@Req() req: any, @Body() dto: RequestDto) {
    return this.training.createRequest(req.user, dto);
  }

  @Post('requests/:id/decide')
  decide(@Req() req: any, @Param('id') id: string, @Body() dto: DecideDto) {
    return this.training.decide(req.user, id, dto);
  }
}
