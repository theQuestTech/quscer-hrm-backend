// Sends email through Resend (https://resend.com). Set RESEND_API_KEY on the
// server; RESEND_FROM picks the sender (the domain must be verified in
// Resend). Without a key, email is simply off and callers say so.

import { Injectable, Logger } from '@nestjs/common';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class Mailer {
  private readonly log = new Logger('Mailer');

  get enabled(): boolean {
    return !!process.env.RESEND_API_KEY;
  }

  // Returns false if the email couldn't be sent. Never throws, so a mail
  // problem can't reveal anything to the person asking.
  async send(email: Email): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const res = await fetch(process.env.RESEND_API_URL ?? 'https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.RESEND_FROM ?? 'Quscer People <no-reply@quscer.com>',
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
      });
      if (!res.ok) {
        this.log.error(`Resend refused an email (${res.status}): ${(await res.text()).slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (e) {
      this.log.error(`Could not reach Resend: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }
}
