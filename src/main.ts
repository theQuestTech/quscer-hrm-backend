import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { text } from 'express';
import { createServer } from 'http';
import { machineOnly } from './attendance-devices/machine-port';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Standard security headers (HSTS, nosniff, no framing, no X-Powered-By). No CSP: this
  // serves JSON and files, not pages. Photos and documents are shown on the HRM site's own
  // domain, so they may be loaded cross-origin.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // Attendance machines (ZKTeco ADMS) upload punches as plain text, whatever
  // content type they claim. Read it as text before the JSON/form parsers.
  app.use('/iclock', text({ type: () => true, limit: '5mb' }));
  // Resend's delivery reports are signed over the exact body, so keep it as text.
  app.use('/webhooks/resend', text({ type: () => true, limit: '1mb' }));
  // CORS_ORIGINS (comma-separated) limits which sites may call the API —
  // set it to the frontend's URL in production. Unset = any origin (dev only).
  const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  // X-Missing-Bank-Details is read by the frontend after a bank-file download.
  app.enableCors({
    ...(corsOrigins?.length && { origin: corsOrigins }),
    exposedHeaders: ['X-Missing-Bank-Details', 'Content-Disposition'],
  });
  const port = process.env.PORT ?? 4100;
  await app.listen(port);
  console.log(`Quscer HRM backend listening on port ${port}`);

  // Older attendance machines can only speak plain HTTP. MACHINE_PORT opens a
  // second door that answers the machine address (/iclock) and nothing else.
  const machinePort = process.env.MACHINE_PORT;
  if (machinePort) {
    createServer(machineOnly(app.getHttpAdapter().getInstance())).listen(Number(machinePort), () =>
      console.log(`Attendance machines (plain HTTP) on port ${machinePort}`),
    );
  }
}
bootstrap();
