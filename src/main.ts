import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { SafeHttpExceptionFilter } from './core/security/safe-http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // KYC files are transported through the authenticated JSON proxy as base64.
  // The service applies the stricter 8 MB decoded-file limit and type checks.
  app.use(json({ limit: '12mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  const httpServer = app.getHttpAdapter().getInstance();
  httpServer.disable('x-powered-by');
  // Only accept forwarding metadata from a loopback reverse proxy. Direct
  // callers cannot spoof their address to evade sensitive-route throttling.
  httpServer.set('trust proxy', 'loopback');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new SafeHttpExceptionFilter());
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-DNS-Prefetch-Control', 'off');
    response.setHeader('X-Download-Options', 'noopen');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    next();
  });
  await app.listen(process.env.PORT ?? 3000, process.env.HOST ?? '127.0.0.1');
}
bootstrap();
