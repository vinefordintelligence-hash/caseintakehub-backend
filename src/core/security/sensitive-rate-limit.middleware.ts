import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { GatewayRequest } from '../gateway/gateway-request';

type Limit = { requests: number; windowMs: number };
type Bucket = { count: number; resetAt: number };

const SENSITIVE_ROUTES: Record<string, Limit> = {
  'POST /client-auth/login': { requests: 10, windowMs: 15 * 60_000 },
  'POST /client-auth/admin/reset-pin': { requests: 6, windowMs: 15 * 60_000 },
  'POST /intakes': { requests: 12, windowMs: 15 * 60_000 },
  'POST /intakes/public-submit': { requests: 12, windowMs: 15 * 60_000 },
  'POST /intakes/resume': { requests: 20, windowMs: 15 * 60_000 },
  'POST /kyc/requirements/:id/upload': { requests: 12, windowMs: 15 * 60_000 },
};

@Injectable()
export class SensitiveRateLimitMiddleware implements NestMiddleware {
  private readonly buckets = new Map<string, Bucket>();

  use(request: GatewayRequest, response: Response, next: NextFunction): void {
    const path = request.url.split('?', 1)[0].replace(/\/$/, '') || '/';
    const route = `${request.method.toUpperCase()} ${path}`;
    const normalizedRoute = /^POST \/kyc\/requirements\/[^/]+\/upload$/.test(
      route,
    )
      ? 'POST /kyc/requirements/:id/upload'
      : route;
    const limit = SENSITIVE_ROUTES[normalizedRoute];
    if (!limit) return next();

    response.setHeader('Cache-Control', 'no-store');
    const now = Date.now();
    this.prune(now);
    const address = request.ip || request.socket?.remoteAddress || 'unknown';
    const key = `${normalizedRoute}:${address}`;
    const current = this.buckets.get(key);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + limit.windowMs }
        : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);

    const remaining = Math.max(limit.requests - bucket.count, 0);
    response.setHeader('RateLimit-Limit', String(limit.requests));
    response.setHeader('RateLimit-Remaining', String(remaining));
    response.setHeader(
      'RateLimit-Reset',
      String(Math.ceil(bucket.resetAt / 1000)),
    );
    if (bucket.count <= limit.requests) return next();

    const retryAfter = Math.max(Math.ceil((bucket.resetAt - now) / 1000), 1);
    response.setHeader('Retry-After', String(retryAfter));
    response.status(429).json({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many authentication attempts; try again later',
      requestId: request.vfRequestId,
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    while (this.buckets.size > 10_000) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (!oldest) break;
      this.buckets.delete(oldest);
    }
  }
}
