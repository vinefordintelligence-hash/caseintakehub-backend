import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Response } from 'express';
import { GatewayRequest } from './gateway-request';

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMPATIBILITY_PREFIX = '/api/vf';

@Injectable()
export class ApiGatewayMiddleware implements NestMiddleware {
  use(request: GatewayRequest, response: Response, next: NextFunction): void {
    const suppliedRequestId = request.headers['x-request-id'];
    const requestId =
      typeof suppliedRequestId === 'string' &&
      SAFE_REQUEST_ID.test(suppliedRequestId)
        ? suppliedRequestId
        : randomUUID();

    request.vfRequestId = requestId;
    request.headers['x-request-id'] = requestId;
    response.setHeader('X-Request-Id', requestId);

    // Browser-provided role/user values must never cross the gateway as a
    // trusted identity. The global identity guard derives authority from the
    // bearer token and current server-side records.
    delete request.headers['x-role'];
    delete request.headers['x-user-id'];

    if (
      request.url === COMPATIBILITY_PREFIX ||
      request.url.startsWith(`${COMPATIBILITY_PREFIX}/`) ||
      request.url.startsWith(`${COMPATIBILITY_PREFIX}?`)
    ) {
      const suffix = request.url.slice(COMPATIBILITY_PREFIX.length);
      request.url =
        suffix === '' ? '/' : suffix.startsWith('?') ? `/${suffix}` : suffix;
      request.vfApiNamespace = 'compatibility';
      response.setHeader('X-Vineford-API-Version', '1');
    } else {
      request.vfApiNamespace = 'legacy';
      response.setHeader('X-Vineford-API-Version', 'legacy');
    }

    next();
  }
}
