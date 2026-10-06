import { ConflictException, Controller, ForbiddenException, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { isStaging } from '../common/environment';
import { PrismaService } from '../prisma/prisma.service';
import { buildDemo, DEMO } from '../scripts/demo-seed';
import { SupportCaller, SupportGuard } from './support-auth';

/** The "Rebuild demo" button in the support console — staging only. Same as running
 *  `npm run demo:reset` on the server: the demo company is emptied and built fresh. */
@Controller('support/demo')
@UseGuards(SupportGuard)
export class DemoController {
  private running = false;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async status() {
    const demo = await this.prisma.organization.findFirst({ where: { name: DEMO.companyName }, select: { id: true, createdAt: true } });
    return {
      available: isStaging(),
      running: this.running,
      demo,
      logins: isStaging() ? { hr: DEMO.hr.email, manager: DEMO.manager, employee: DEMO.employee } : null,
    };
  }

  @Post('reset')
  @HttpCode(200)
  async reset(@Req() req: { agent: SupportCaller }) {
    if (!isStaging()) throw new ForbiddenException('The demo can only be rebuilt on the staging server');
    if (!req.agent.twoStepOn) throw new ForbiddenException('Turn on two-step sign-in first');
    if (this.running) throw new ConflictException('The demo is already being rebuilt — wait a few seconds');
    this.running = true;
    try {
      const result = await buildDemo({ get: (type) => this.moduleRef.get(type, { strict: false }) }, { reset: true });
      await this.prisma.supportAction.create({ data: { agentId: req.agent.agentId, action: 'demo.rebuilt', organizationId: result.built ? (result.organizationId ?? null) : null } });
      return result;
    } finally {
      this.running = false;
    }
  }
}
