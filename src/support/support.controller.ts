import { Body, Controller, Get, Headers, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RateLimiter } from '../recruitment/recruitment-rules';
import { visitorAddress } from '../common/visitor-address';
import { SupportAuthService, SupportGuard } from './support-auth';
import { SupportService } from './support.service';
import { SupportTwoStepService } from './support-two-step';
import { TicketsService } from './tickets.service';
import {
  AddAgentDto, AgentReplyDto, SupportForgotDto, SupportLoginDto, SupportLoginTwoStepDto, SupportResetDto, SupportTwoStepConfirmDto, SuspendDto, TicketStatusDto, UpdateAgentDto, ViewAsDto,
} from './dto';

const signInPerVisitor = new RateLimiter(20, 15 * 60 * 1000);
const signInPerEmail = new RateLimiter(8, 15 * 60 * 1000);
const codeConfirmTries = new RateLimiter(10, 15 * 60 * 1000);
const tooMany = () => new HttpException('Too many tries — please wait a while and try again', HttpStatus.TOO_MANY_REQUESTS);

// Signing in to the console (no support token yet).
@Controller('support/auth')
export class SupportAuthController {
  constructor(private auth: SupportAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Req() req: Request, @Body() dto: SupportLoginDto) {
    if (!signInPerVisitor.allow(visitorAddress(req)) || !signInPerEmail.allow(dto.email.trim().toLowerCase())) throw tooMany();
    return this.auth.login(dto.email, dto.password);
  }

  @Post('login/two-step')
  @HttpCode(200)
  loginTwoStep(@Req() req: Request, @Body() dto: SupportLoginTwoStepDto) {
    if (!signInPerVisitor.allow(visitorAddress(req))) throw tooMany();
    return this.auth.loginTwoStep(dto.challengeToken, dto.code, dto.backupCode);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgot(@Req() req: Request, @Body() dto: SupportForgotDto) {
    if (!signInPerVisitor.allow(visitorAddress(req))) throw tooMany();
    if (!signInPerEmail.allow(`forgot:${dto.email.trim().toLowerCase()}`)) return { ok: true };
    return this.auth.forgot(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  reset(@Req() req: Request, @Body() dto: SupportResetDto) {
    if (!signInPerVisitor.allow(visitorAddress(req))) throw tooMany();
    return this.auth.reset(dto.token, dto.newPassword);
  }
}

// Everything else needs a support token.
@Controller('support')
@UseGuards(SupportGuard)
export class SupportController {
  constructor(
    private auth: SupportAuthService,
    private support: SupportService,
    private tickets: TicketsService,
    private twoStep: SupportTwoStepService,
  ) {}

  @Get('auth/me')
  me(@Req() req: any) {
    return this.auth.me(req.agent);
  }

  // --- Your two-step sign-in (always required for support staff) ---------------------

  @Get('two-step')
  twoStepStatus(@Req() req: any) {
    return this.twoStep.status(req.agent.agentId);
  }

  @Post('two-step/setup')
  @HttpCode(200)
  twoStepSetup(@Req() req: any) {
    return this.twoStep.startSetup(req.agent.agentId);
  }

  @Post('two-step/confirm')
  @HttpCode(200)
  twoStepConfirm(@Req() req: any, @Body() dto: SupportTwoStepConfirmDto) {
    if (!codeConfirmTries.allow(req.agent.agentId)) throw tooMany();
    return this.twoStep.confirmSetup(req.agent.agentId, dto.code);
  }

  @Post('two-step/backup-codes')
  @HttpCode(200)
  twoStepBackupCodes(@Req() req: any, @Headers('x-two-step-code') code?: string) {
    return this.twoStep.regenerateBackupCodes(req.agent.agentId, code);
  }

  @Get('overview')
  async overview() {
    return { ...(await this.support.overview()), tickets: await this.tickets.counts() };
  }

  @Get('companies')
  companies(@Query('q') q?: string) {
    return this.support.companies(q);
  }

  @Get('companies/:id')
  company(@Param('id') id: string) {
    return this.support.company(id);
  }

  @Post('companies/:id/suspend')
  @HttpCode(200)
  suspend(@Req() req: any, @Param('id') id: string, @Body() dto: SuspendDto) {
    return this.support.suspend(req.agent, id, dto.reason);
  }

  @Post('companies/:id/resume')
  @HttpCode(200)
  resume(@Req() req: any, @Param('id') id: string) {
    return this.support.resume(req.agent, id);
  }

  @Post('companies/:id/users/:userId/reset-link')
  @HttpCode(200)
  resetLink(@Req() req: any, @Param('id') id: string, @Param('userId') userId: string) {
    return this.support.sendResetLink(req.agent, id, userId);
  }

  @Post('companies/:id/users/:userId/welcome')
  @HttpCode(200)
  welcome(@Req() req: any, @Param('id') id: string, @Param('userId') userId: string) {
    return this.support.resendWelcome(req.agent, id, userId);
  }

  @Post('users/:userId/view')
  viewAs(@Req() req: any, @Param('userId') userId: string, @Body() dto: ViewAsDto) {
    return this.support.viewAs(req.agent, dto.organizationId, userId, dto.reason);
  }

  @Post('views/:id/end')
  @HttpCode(200)
  endView(@Req() req: any, @Param('id') id: string) {
    return this.support.endView(req.agent, id);
  }

  @Get('tickets')
  ticketList(@Query('status') status?: string, @Query('organizationId') organizationId?: string) {
    return this.tickets.list({ status, organizationId });
  }

  @Get('tickets/:id')
  ticket(@Param('id') id: string) {
    return this.tickets.one(id);
  }

  @Post('tickets/:id/messages')
  reply(@Req() req: any, @Param('id') id: string, @Body() dto: AgentReplyDto) {
    return this.tickets.agentReply(req.agent, id, dto.body, !!dto.close);
  }

  @Post('tickets/:id/status')
  @HttpCode(200)
  status(@Req() req: any, @Param('id') id: string, @Body() dto: TicketStatusDto) {
    return this.tickets.setStatus(req.agent, id, dto.status);
  }

  @Get('activity')
  activity() {
    return this.support.activity();
  }

  @Get('team')
  team() {
    return this.auth.team();
  }

  @Post('team')
  addAgent(@Req() req: any, @Body() dto: AddAgentDto) {
    return this.auth.addAgent(req.agent, dto.email, dto.name);
  }

  // For a lost phone with no backup codes: they set it up again on their next visit.
  @Post('team/:id/reset-two-step')
  @HttpCode(200)
  resetTwoStep(@Req() req: any, @Param('id') id: string, @Headers('x-two-step-code') code?: string) {
    return this.twoStep.reset(req.agent, id, code);
  }

  @Patch('team/:id')
  async updateAgent(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    if (dto.name !== undefined) await this.auth.rename(req.agent, id, dto.name);
    if (dto.isActive !== undefined) await this.auth.setActive(req.agent, id, dto.isActive);
    return { ok: true };
  }
}
