import { ArgumentsHost, Catch, ExceptionFilter, Injectable, NestInterceptor } from '@nestjs/common';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { errorBody } from './errors';
import { whitelabelText } from './domain';
import { applyAuthCookie, clearAuthCookie } from './identity.controller';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      map((data) => {
        if (res.headersSent) return data;
        const path = String(req.path || '');
        if (path === '/healthz' || path === '/mcp') return data;
        if (data && typeof data === 'object' && 'logged_out' in (data as Record<string, unknown>)) {
          const portal = (data as { portal?: string }).portal === 'admin' ? 'admin' : 'www';
          clearAuthCookie(res, portal);
        }
        applyAuthCookie(req, res, data);
        if (data && typeof data === 'object' && '__page' in (data as Record<string, unknown>)) {
          const { __page, ...rest } = data as Record<string, unknown>;
          return { ok: true, request_id: req.requestId, data: rest, meta: __page };
        }
        return { ok: true, request_id: req.requestId, data: data ?? null };
      }),
    );
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    if (res.headersSent) return;
    const body = errorBody(exception);
    const path = String(req.path || req.url || '');
    if (path === '/mcp' || path.startsWith('/mcp?')) {
      res.status(body.status).json({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: { code: -32000, message: whitelabelText(body.message), data: { code: body.code, request_id: req.requestId } },
      });
      return;
    }
    if (body.status >= 500) {
      const raw = exception instanceof Error ? exception.message : 'error';
      console.error(JSON.stringify({ request_id: req.requestId, code: body.code, message: whitelabelText(raw) }));
    }
    res.status(body.status).json({
      ok: false,
      request_id: req.requestId,
      error: {
        code: body.code,
        message: whitelabelText(body.message),
        details: body.details,
        retryable: body.retryable,
      },
    });
  }
}
