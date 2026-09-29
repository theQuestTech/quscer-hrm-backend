import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimiter } from '../recruitment/recruitment-rules';
import { TwoStepService } from './two-step.service';

const codeChecks = new RateLimiter(10, 60 * 1000);
const tooMany = () => new HttpException('Too many tries — please wait a minute', HttpStatus.TOO_MANY_REQUESTS);

/** Settings › Two-step sign-in for the signed-in person. Open even before setup when it's required. */
@UseGuards(JwtAuthGuard)
@Controller('auth/two-step')
export class TwoStepController {
  constructor(
    private readonly twoStep: TwoStepService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private record(req: any, eventType: string, metadata: Record<string, string | number | boolean> = {}) {
    return this.prisma.auditEvent.create({ data: { organizationId: req.user.organizationId, actorUserId: req.user.id, eventType, entityType: 'User', entityId: req.user.id, metadata } });
  }

  @Get()
  status(@Req() req: any) {
    return this.twoStep.status(req.user.id, req.user.organizationId);
  }

  @Post('setup')
  @HttpCode(200)
  setup(@Req() req: any) {
    return this.twoStep.startSetup(req.user.id);
  }

  /** Returns backup codes and a new sign-in without the "setup required" flag. */
  @Post('confirm')
  @HttpCode(200)
  async confirm(@Req() req: any, @Body('code') code: string) {
    if (!codeChecks.allow(req.user.id)) throw tooMany();
    const { backupCodes } = await this.twoStep.confirmSetup(req.user.id, code);
    await this.record(req, 'user.two_step_enabled', { codeConfirmed: true });
    const { accessToken } = await this.auth.issueToken(req.user.id, req.user.organizationId, req.user.email);
    return { backupCodes, accessToken };
  }

  @Post('disable')
  @HttpCode(200)
  async disable(@Req() req: any, @Body('code') code: string) {
    if (!codeChecks.allow(req.user.id)) throw tooMany();
    const res = await this.twoStep.disable(req.user.id, req.user.organizationId, code);
    await this.record(req, 'user.two_step_disabled', { codeConfirmed: true });
    return res;
  }

  @Post('backup-codes')
  @HttpCode(200)
  async backupCodes(@Req() req: any, @Body('code') code: string) {
    if (!codeChecks.allow(req.user.id)) throw tooMany();
    const res = await this.twoStep.regenerateBackupCodes(req.user.id, code);
    await this.record(req, 'user.backup_codes_replaced', { codeConfirmed: true });
    return res;
  }

  @Post('forget-devices')
  @HttpCode(200)
  async forgetDevices(@Req() req: any) {
    const res = await this.twoStep.forgetDevices(req.user.id);
    await this.record(req, 'user.trusted_computers_forgotten', { removed: res.removed });
    return res;
  }
}

/** Company-wide choice: two-step for everyone. HR settings permission, confirmed with a code. */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('settings/security')
export class CompanySecurityController {
  constructor(
    private readonly twoStep: TwoStepService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermission('hrm.settings.write')
  async get(@Req() req: any) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: req.user.organizationId }, select: { requireTwoStepForAll: true } });
    return org;
  }

  @Patch()
  @RequirePermission('hrm.settings.write')
  async update(@Req() req: any, @Body('requireTwoStepForAll') requireTwoStepForAll: boolean) {
    if (typeof requireTwoStepForAll !== 'boolean') throw new BadRequestException('Choose on or off');
    await this.twoStep.requireCode(req);
    await this.prisma.organization.update({ where: { id: req.user.organizationId }, data: { requireTwoStepForAll } });
    await this.prisma.auditEvent.create({
      data: { organizationId: req.user.organizationId, actorUserId: req.user.id, eventType: 'organization.two_step_for_all', entityType: 'Organization', entityId: req.user.organizationId, metadata: { on: requireTwoStepForAll, codeConfirmed: true } },
    });
    return { requireTwoStepForAll };
  }
}
