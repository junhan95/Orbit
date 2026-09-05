import { AsyncLocalStorage } from 'node:async_hooks';

type Context = { requestId?: string; route?: string; cfRay?: string; taskId?: string; runId?: string; projectId?: string | null; paymentId?: string; jobId?: string; operation?: string };
const context = new AsyncLocalStorage<Context>();
export const traceContext = () => context.getStore() ?? {};
export function withTrace<T>(fields: Context, work: () => T): T { return context.run({ ...traceContext(), ...fields }, work); }
export function addTrace(fields: Context) { Object.assign(context.getStore() ?? {}, fields); }

/** Only explicit metadata is logged. Never log request bodies, URLs, credentials or error messages. */
export function traceEvent(event: string, fields: Record<string, string | number | boolean | null | undefined> = {}, level: 'info' | 'warn' | 'error' = 'info') {
  console[level](JSON.stringify({ event, timestamp: new Date().toISOString(), ...traceContext(), ...fields }));
}
export function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown_error';
  if (/FOREIGN KEY constraint failed/.test(error.message)) return 'db_foreign_key';
  if (/transaction_guard_passed/.test(error.message)) return 'db_precondition';
  if (/D1_ERROR|SQLITE_/.test(error.message)) return 'db_error';
  if ('code' in error && typeof error.code === 'string' && /^[\w.-]{1,80}$/.test(error.code)) return error.code;
  return error.name === 'TimeoutError' || error.name === 'AbortError' ? 'upstream_timeout' : 'internal_error';
}
export function traceError(event: string, error: unknown) { traceEvent(event, { code: errorCode(error) }, 'error'); }

export function traceRequest<C>(route: string, handler: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, routeContext: C): Promise<Response> => {
    const supplied = request.headers.get('x-request-id');
    const requestId = supplied && /^[a-f0-9-]{36}$/i.test(supplied) ? supplied : crypto.randomUUID();
    const ray = request.headers.get('cf-ray');
    return withTrace({ requestId, route, cfRay: ray && /^[\w-]{1,80}$/.test(ray) ? ray : undefined }, async () => {
      const started = Date.now();
      traceEvent('request.started');
      let response: Response;
      try { response = await handler(request, routeContext); }
      catch (error) {
        traceError('request.failed', error);
        const status = error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status <= 599 ? error.status : 500;
        response = Response.json({ error: status === 401 ? '로그인이 필요합니다.' : '요청을 처리하지 못했습니다. 요청 ID로 문의해 주세요.', code: errorCode(error), requestId }, { status });
      }
      const headers = new Headers(response.headers); headers.set('x-request-id', requestId);
      traceEvent('request.finished', { status: response.status, durationMs: Date.now() - started }, response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    });
  };
}
