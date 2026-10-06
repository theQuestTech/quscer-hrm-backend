import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../notifications/mail.module';
import { SupportAuthService, SupportGuard, supportJwtProvider } from './support-auth';
import { SupportService } from './support.service';
import { SupportTwoStepService } from './support-two-step';
import { TicketsService } from './tickets.service';
import { SupportAuthController, SupportController } from './support.controller';
import { HelpController } from './help.controller';
import { EmailWebhookController } from './email-webhook';
import { DemoController } from './demo.controller';

// The Quscer support console (/support/*), "Get help" for customers
// (/help/*) and Resend's delivery reports (/webhooks/resend).
@Module({
  imports: [AuthModule, MailModule],
  controllers: [SupportAuthController, SupportController, HelpController, EmailWebhookController, DemoController],
  providers: [supportJwtProvider, SupportGuard, SupportAuthService, SupportService, TicketsService, SupportTwoStepService],
})
export class SupportModule {}
