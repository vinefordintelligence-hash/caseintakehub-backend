import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { GatewayRequest } from '../gateway/gateway-request';

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<GatewayRequest>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: status, message: 'Internal server error' };
    const normalized = this.normalize(
      body,
      status,
      request.originalUrl ?? request.url,
    );
    const requestId = request.vfRequestId ?? randomUUID();
    response.setHeader('X-Request-Id', requestId);
    response.status(status).json({
      ...normalized,
      requestId,
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private normalize(
    body: string | object,
    status: number,
    path: string,
  ): { statusCode: number; error: string; message: string } {
    if (status >= 500) {
      const gatewayFailure = status === HttpStatus.BAD_GATEWAY;
      const timeout = status === HttpStatus.GATEWAY_TIMEOUT;
      const unavailable = status === HttpStatus.SERVICE_UNAVAILABLE;
      return {
        statusCode: status,
        error: gatewayFailure
          ? 'Bad Gateway'
          : timeout
            ? 'Gateway Timeout'
            : unavailable
              ? 'Service Unavailable'
              : 'Internal Server Error',
        message: timeout
          ? 'Upstream service timed out'
          : gatewayFailure || unavailable
            ? 'Upstream service unavailable'
            : 'Internal server error',
      };
    }
    if (status === HttpStatus.UNAUTHORIZED) {
      const record =
        typeof body === 'string'
          ? { message: body }
          : (body as Record<string, unknown>);
      const clientLoginFailure =
        path.includes('/client-auth/login') &&
        record.message === 'Unable to verify case access';
      return {
        statusCode: status,
        error: 'Unauthorized',
        message: clientLoginFailure
          ? 'Unable to verify case access'
          : 'Authentication failed',
      };
    }
    if (status === HttpStatus.FORBIDDEN)
      return {
        statusCode: status,
        error: 'Forbidden',
        message: 'Access denied',
      };
    const record =
      typeof body === 'string'
        ? { message: body }
        : (body as Record<string, unknown>);
    const rawMessage = record.message;
    const message = Array.isArray(rawMessage)
      ? rawMessage
          .filter((value): value is string => typeof value === 'string')
          .join('; ')
      : typeof rawMessage === 'string'
        ? rawMessage
        : 'Request failed';
    const error =
      typeof record.error === 'string'
        ? record.error
        : status === HttpStatus.UNAUTHORIZED
          ? 'Unauthorized'
          : status === HttpStatus.FORBIDDEN
            ? 'Forbidden'
            : 'Request Error';
    return { statusCode: status, error, message };
  }
}
