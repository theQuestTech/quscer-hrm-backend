import { Module } from '@nestjs/common';
import { Mailer } from '../auth/mailer';

// Email sending on its own, so sign-in and notifications can both use it.
@Module({
  providers: [Mailer],
  exports: [Mailer],
})
export class MailModule {}
