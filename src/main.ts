import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors(); // tighten this before production — currently wide open
  const port = process.env.PORT ?? 4100;
  await app.listen(port);
  console.log(`Quscer HRM backend listening on port ${port}`);
}
bootstrap();
