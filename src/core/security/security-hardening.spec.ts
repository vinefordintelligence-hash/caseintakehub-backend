import { ArgumentsHost } from '@nestjs/common/interfaces';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SensitiveRateLimitMiddleware } from './sensitive-rate-limit.middleware';
import { SafeHttpExceptionFilter } from './safe-http-exception.filter';
import { SupabaseIdentityService } from '../../identity/supabase-identity.service';

function responseDouble() {
  return {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('Module 38 additive security hardening', () => {
  it('rate limits client login without trusting forwarded identity headers', () => {
    const middleware = new SensitiveRateLimitMiddleware();
    const response = responseDouble();
    const next = jest.fn();
    for (let index = 0; index < 11; index += 1) {
      middleware.use(
        {
          method: 'POST',
          url: '/client-auth/login',
          originalUrl: '/api/vf/client-auth/login',
          headers: { 'x-forwarded-for': `spoofed-${index}` },
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
          vfRequestId: 'request-rate',
        } as never,
        response as never,
        next,
      );
    }
    expect(next).toHaveBeenCalledTimes(10);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        requestId: 'request-rate',
      }),
    );
  });

  it('does not throttle unrelated protected resources', () => {
    const middleware = new SensitiveRateLimitMiddleware();
    const next = jest.fn();
    middleware.use(
      { method: 'GET', url: '/cases', headers: {}, socket: {} } as never,
      responseDouble() as never,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('normalizes authentication and authorization errors without leaking reasons', () => {
    const response = responseDouble();
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          originalUrl: '/cases',
          vfRequestId: 'request-auth',
        }),
      }),
    } as ArgumentsHost;
    const filter = new SafeHttpExceptionFilter();
    filter.catch(
      new UnauthorizedException('Supabase configuration and token details'),
      host,
    );
    expect(response.json).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Authentication failed' }),
    );
    filter.catch(
      new ForbiddenException('actor has no membership in secret organization'),
      host,
    );
    expect(response.json).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Access denied' }),
    );
  });

  it('preserves the generic client-login failure contract', () => {
    const response = responseDouble();
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          originalUrl: '/api/vf/client-auth/login',
          vfRequestId: 'request-client',
        }),
      }),
    } as ArgumentsHost;
    new SafeHttpExceptionFilter().catch(
      new UnauthorizedException('Unable to verify case access'),
      host,
    );
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Unable to verify case access' }),
    );
  });

  it('rejects malformed bearer syntax before upstream or database access', async () => {
    const data = { query: jest.fn() };
    const service = new SupabaseIdentityService(
      { get: jest.fn() } as never,
      data as never,
      { verifyAsync: jest.fn() } as never,
    );
    await expect(
      service.verify('Bearer token with spaces'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verify('Basic token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(data.query).not.toHaveBeenCalled();
  });
});
