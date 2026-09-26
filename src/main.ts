import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { text } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Attendance machines (ZKTeco ADMS) upload punches as plain text, whatever
  // content type they claim. Read it as text before the JSON/form parsers.
  app.use('/iclock', text({ type: () => true, limit: '5mb' }));
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
}
bootstrap();
