import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind Cloudflare Tunnel → trust X-Forwarded-For / X-Forwarded-Proto
  // from the immediate proxy hop only.
  app.set('trust proxy', 1);

  app.use(helmet());

  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(',') ?? [],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // reject payloads with unknown properties
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
