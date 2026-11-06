import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { map } from 'rxjs';

function requestId(request: Request, response: Response): string {
  const supplied = request.headers['x-request-id'];
  const id =
    typeof supplied === 'string' && /^[\w.-]{1,100}$/.test(supplied)
      ? supplied
      : randomUUID();
  request.headers['x-request-id'] = id;
  response.setHeader('X-Request-Id', id);
  return id;
}

@Injectable()
export class OrdersResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const id = requestId(
      http.getRequest<Request>(),
      http.getResponse<Response>(),
    );
    return next
      .handle()
      .pipe(
        map((body) => ({ ...body, meta: { ...body.meta, requestId: id } })),
      );
  }
}

@Catch()
export class OrdersExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OrdersExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const id = requestId(http.getRequest<Request>(), response);
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const raw =
      exception instanceof HttpException ? exception.getResponse() : null;
    const body =
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, any>)
        : {};
    // Hỗ trợ payload lỗi nghiệp vụ top-level mà không làm sai kiểu lỗi ValidationPipe.
    const custom =
      body.error ?? (typeof body.code === 'string' ? body : undefined);
    if (status >= 500)
      this.logger.error(`Order request failed; requestId=${id}`);
    const defaults: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN_RESOURCE',
      404: 'ORDER_NOT_FOUND',
      409: 'INVENTORY_CONFLICT',
      422: 'COUPON_NOT_APPLICABLE',
    };
    response.status(status).json({
      error: {
        code: custom?.code ?? defaults[status] ?? 'INTERNAL_ERROR',
        message:
          (typeof custom?.message === 'string' ? custom.message : undefined) ??
          (status >= 500
            ? 'Unable to process order.'
            : typeof body.message === 'string'
              ? body.message
              : 'Invalid request.'),
        details:
          custom?.details ?? (Array.isArray(body.message) ? body.message : []),
        requestId: id,
      },
    });
  }
}
