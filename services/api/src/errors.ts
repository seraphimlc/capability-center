import { HttpException } from '@nestjs/common';
import { errorDef } from '@cc/error-codes';

export class ApiException extends HttpException {
  constructor(code: string, message?: string, details?: Record<string, unknown>) {
    const def = errorDef(code);
    super(
      {
        code,
        message: message ?? def.message,
        details,
        retryable: def.retryable,
      },
      def.http,
    );
  }
}

export function errorBody(exception: unknown): {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
} {
  if (exception instanceof ApiException) {
    const body = exception.getResponse() as {
      code: string;
      message: string;
      details?: Record<string, unknown>;
      retryable: boolean;
    };
    return { status: exception.getStatus(), ...body };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status === 400) return { status, code: 'VALIDATION_ERROR', message: '参数不正确', retryable: false };
    if (status === 401) return { status, code: 'UNAUTHORIZED', message: '请先登录', retryable: false };
    if (status === 403) return { status, code: 'FORBIDDEN', message: '没有权限执行此操作', retryable: false };
    if (status === 404) return { status, code: 'NOT_FOUND', message: '资源不存在或已下线', retryable: false };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: '服务繁忙，请稍后重试', retryable: true };
}
