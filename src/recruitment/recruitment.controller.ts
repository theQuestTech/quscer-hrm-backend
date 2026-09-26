import {
  Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { InterviewStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RecruitmentService } from './recruitment.service';
import {
  AddCandidateDto, ApplyDto, FeedbackDto, HireDto, InterviewDto, JobDto, MoveDto, NotesDto, OfferDto, OfferStatusDto,
} from './recruitment.dto';
import { MAX_CV_BYTES, RateLimiter } from './recruitment-rules';

class UpdateJobDto extends PartialType(JobDto) {}
class UpdateInterviewDto extends PartialType(InterviewDto) {
  @IsOptional() @IsEnum(InterviewStatus) status?: InterviewStatus;
}

// Reads just past the limit so a huge upload can't fill memory.
const cvUpload = FileInterceptor('cv', { limits: { fileSize: MAX_CV_BYTES + 1, files: 1, fields: 20 } });

function sendFile(res: Response, file: { fileName: string; mimeType: string; data: Uint8Array | Buffer }) {
  res.set({
    'Content-Type': file.mimeType,
    'Content-Disposition': `attachment; filename="${file.fileName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  res.send(Buffer.from(file.data));
}

// Who may do what is decided in RecruitmentService (HR / hiring manager /
// interviewer).
@Controller('recruitment')
@UseGuards(JwtAuthGuard)
export class RecruitmentController {
  constructor(private recruitment: RecruitmentService) {}

  @Get('careers-link')
  careersLink(@Req() req: any) {
    return this.recruitment.careersLink(req.user);
  }

  @Get('jobs')
  listJobs(@Req() req: any) {
    return this.recruitment.listJobs(req.user);
  }

  @Post('jobs')
  createJob(@Req() req: any, @Body() dto: JobDto) {
    return this.recruitment.createJob(req.user, dto);
  }

  @Get('jobs/:id')
  getJob(@Req() req: any, @Param('id') id: string) {
    return this.recruitment.getJob(req.user, id);
  }

  @Patch('jobs/:id')
  updateJob(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateJobDto) {
    return this.recruitment.updateJob(req.user, id, dto);
  }

  @Delete('jobs/:id')
  removeJob(@Req() req: any, @Param('id') id: string) {
    return this.recruitment.removeJob(req.user, id);
  }

  @Get('applications')
  listApplications(@Req() req: any, @Query() q: { stage?: string; jobId?: string; search?: string }) {
    return this.recruitment.listApplications(req.user, q);
  }

  @Post('applications')
  @UseInterceptors(cvUpload)
  addCandidate(@Req() req: any, @Body() dto: AddCandidateDto, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.recruitment.addCandidate(req.user, dto, file);
  }

  @Get('applications/:id')
  getApplication(@Req() req: any, @Param('id') id: string) {
    return this.recruitment.getApplication(req.user, id);
  }

  @Get('applications/:id/cv')
  async downloadCv(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    sendFile(res, await this.recruitment.downloadCv(req.user, id));
  }

  @Post('applications/:id/move')
  move(@Req() req: any, @Param('id') id: string, @Body() dto: MoveDto) {
    return this.recruitment.move(req.user, id, dto);
  }

  @Put('applications/:id/notes')
  setNotes(@Req() req: any, @Param('id') id: string, @Body() dto: NotesDto) {
    return this.recruitment.setNotes(req.user, id, dto.notes);
  }

  @Post('applications/:id/interviews')
  scheduleInterview(@Req() req: any, @Param('id') id: string, @Body() dto: InterviewDto) {
    return this.recruitment.scheduleInterview(req.user, id, dto);
  }

  @Put('applications/:id/offer')
  setOffer(@Req() req: any, @Param('id') id: string, @Body() dto: OfferDto) {
    return this.recruitment.setOffer(req.user, id, dto);
  }

  @Post('applications/:id/offer/status')
  setOfferStatus(@Req() req: any, @Param('id') id: string, @Body() dto: OfferStatusDto) {
    return this.recruitment.setOfferStatus(req.user, id, dto.status);
  }

  @Get('applications/:id/offer-letter')
  async offerLetter(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const pdf = await this.recruitment.offerLetter(req.user, id);
    sendFile(res, { ...pdf, mimeType: 'application/pdf' });
  }

  @Post('applications/:id/hire')
  hire(@Req() req: any, @Param('id') id: string, @Body() dto: HireDto) {
    return this.recruitment.hire(req.user, id, dto);
  }

  @Get('interviews')
  interviews(@Req() req: any, @Query('scope') scope?: string) {
    return this.recruitment.interviews(req.user, scope === 'all' ? 'all' : 'mine');
  }

  @Patch('interviews/:id')
  updateInterview(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateInterviewDto) {
    return this.recruitment.updateInterview(req.user, id, dto);
  }

  @Post('interviews/:id/feedback')
  feedback(@Req() req: any, @Param('id') id: string, @Body() dto: FeedbackDto) {
    return this.recruitment.giveFeedback(req.user, id, dto);
  }
}

// The public careers page — no login. Applying is limited per visitor and
// per company so a script can't flood anyone with applications.
const perVisitor = new RateLimiter(5, 10 * 60 * 1000);
const perCompany = new RateLimiter(300, 60 * 60 * 1000);

// Behind Railway's proxy the visitor's address is the last one added to
// X-Forwarded-For (earlier entries can be made up by the visitor).
function visitorAddress(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const list = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list[list.length - 1] ?? req.socket.remoteAddress ?? 'unknown';
}

@Controller('careers')
export class CareersController {
  constructor(private recruitment: RecruitmentService) {}

  @Get(':slug')
  page(@Param('slug') slug: string) {
    return this.recruitment.careersPage(slug);
  }

  @Get(':slug/jobs/:jobId')
  job(@Param('slug') slug: string, @Param('jobId') jobId: string) {
    return this.recruitment.publicJobDetail(slug, jobId);
  }

  @Post(':slug/jobs/:jobId/apply')
  @UseInterceptors(cvUpload)
  apply(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Param('jobId') jobId: string,
    @Body() dto: ApplyDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!perVisitor.allow(visitorAddress(req)) || !perCompany.allow(slug.toLowerCase())) {
      throw new HttpException('Too many applications — please try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.recruitment.apply(slug, jobId, dto, file);
  }
}
