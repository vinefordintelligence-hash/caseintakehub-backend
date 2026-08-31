import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common/interfaces';
import { ApiGatewayMiddleware } from './api-gateway.middleware';
import { trustedIdentityHeaders } from './gateway-request';
import { requestUpstream, UpstreamRequestError } from './upstream-request';
import { SafeHttpExceptionFilter } from '../security/safe-http-exception.filter';

function responseDouble() {
  return {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('Module 36 API gateway foundation', () => {
  it('keeps legacy routes and exposes /api/vf as a compatibility alias', () => {
    const middleware = new ApiGatewayMiddleware();
    const response = responseDouble();
    const next = jest.fn();
    const legacy = { url: '/cases/one?view=summary', headers: {} } as never;
    middleware.use(legacy, response as never, next);
    expect((legacy as { url: string }).url).toBe('/cases/one?view=summary');
    expect((legacy as { vfApiNamespace: string }).vfApiNamespace).toBe(
      'legacy',
    );

    const compatibility = {
      url: '/api/vf/cases/one?view=summary',
      headers: {},
    } as never;
    middleware.use(compatibility, response as never, next);
    expect((compatibility as { url: string }).url).toBe(
      '/cases/one?view=summary',
    );
    expect((compatibility as { vfApiNamespace: string }).vfApiNamespace).toBe(
      'compatibility',
    );
  });

  it('creates safe request IDs and removes spoofable role/user headers', () => {
    const middleware = new ApiGatewayMiddleware();
    const response = responseDouble();
    const request = {
      url: '/api/vf/cases',
      headers: {
        'x-request-id': 'contains spaces and is unsafe',
        'x-role': 'super_admin',
        'x-user-id': 'spoofed',
        'x-actor-id': 'compatibility-assertion',
      },
    } as never;
    middleware.use(request, response as never, jest.fn());
    const headers = (request as { headers: Record<string, string> }).headers;
    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers['x-role']).toBeUndefined();
    expect(headers['x-user-id']).toBeUndefined();
    expect(headers['x-actor-id']).toBe('compatibility-assertion');
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      headers['x-request-id'],
    );
  });

  it('constructs internal identity headers only from verified identity', () => {
    const headers = trustedIdentityHeaders(
      {
        actorId: 'verified-actor',
        organizationId: 'verified-org',
        role: 'admin',
        supabaseUserId: 'supabase-subject',
        caseId: 'verified-case',
      },
      'request-1',
    );
    expect(headers).toEqual({
      'x-request-id': 'request-1',
      'x-vineford-actor-id': 'verified-actor',
      'x-vineford-organization-id': 'verified-org',
      'x-vineford-role': 'admin',
      'x-vineford-case-id': 'verified-case',
    });
  });

  it('normalizes errors with request IDs and hides unknown failures', () => {
    const response = responseDouble();
    const request = {
      originalUrl: '/api/vf/cases',
      vfRequestId: 'request-safe',
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as ArgumentsHost;
    const filter = new SafeHttpExceptionFilter();

    filter.catch(new Error('password=secret SQL SELECT * FROM users'), host);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal server error',
        requestId: 'request-safe',
      }),
    );

    filter.catch(new BadRequestException(['field must be safe']), host);
    expect(response.json).toHaveBeenLastCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: 'Bad Request',
        message: 'field must be safe',
        requestId: 'request-safe',
      }),
    );

    filter.catch(
      new ServiceUnavailableException('raw provider body: secret'),
      host,
    );
    expect(response.json).toHaveBeenLastCalledWith(
      expect.objectContaining({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Upstream service unavailable',
        requestId: 'request-safe',
      }),
    );
  });

  it('bounds unavailable and timed-out upstream requests without exposing bodies', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('raw upstream secret'));
    await expect(requestUpstream('https://upstream.invalid')).rejects.toEqual(
      expect.objectContaining<Partial<UpstreamRequestError>>({
        kind: 'unavailable',
      }),
    );

    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    ) as typeof fetch;
    const pending = requestUpstream('https://upstream.invalid', {}, 25);
    jest.advanceTimersByTime(25);
    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<UpstreamRequestError>>({
        kind: 'timeout',
      }),
    );
    jest.useRealTimers();
    global.fetch = originalFetch;
  });
});
