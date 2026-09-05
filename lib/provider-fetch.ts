import { errorCode, traceEvent } from './telemetry';

/** Metadata only: URL paths may contain payment keys and must never enter logs. */
export async function providerFetch(provider: 'anthropic' | 'toss' | 'google' | 'github', operation: string, url: string, init: RequestInit): Promise<Response> {
  const started = Date.now();
  try {
    const response = await fetch(url, init);
    const id = response.headers.get('request-id') ?? response.headers.get('x-request-id');
    traceEvent('provider.response', { provider, providerOperation: operation, status: response.status, durationMs: Date.now() - started, providerRequestId: id && /^[\w-]{1,100}$/.test(id) ? id : undefined }, response.ok ? 'info' : 'warn');
    return response;
  } catch (error) {
    traceEvent('provider.failed', { provider, providerOperation: operation, code: errorCode(error), durationMs: Date.now() - started }, 'error');
    throw error;
  }
}
