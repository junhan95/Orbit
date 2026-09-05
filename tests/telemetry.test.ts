import { afterEach, expect, it, vi } from 'vitest';
import { traceEvent, traceRequest, withTrace } from '@/lib/telemetry';
import { runInBackground } from '@/lib/memory-review';
import { drainBackground } from './cloudflare-workers';
import { evalRequest } from '../scripts/eval-http.mjs';
afterEach(() => vi.restoreAllMocks());

it('keeps concurrent request and background IDs separate without logging secrets', async () => {
  const lines: string[] = [];
  vi.spyOn(console, 'info').mockImplementation((line) => { lines.push(line); });
  vi.spyOn(console, 'error').mockImplementation((line) => { lines.push(line); });
  const handler = traceRequest('/api/test', async () => {
    runInBackground(async () => { await Promise.resolve(); throw new Error('secret-api-key'); }, 'test.job');
    await Promise.resolve(); traceEvent('test.event');
    throw new Error('secret-cookie-and-email');
  });
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const responses = await Promise.all(ids.map((id) => handler(new Request('https://test/api/test?paymentKey=secret-url', { headers: { 'x-request-id': id, cookie: 'secret-cookie' } }), undefined)));
  await drainBackground();
  for (let i = 0; i < ids.length; i++) {
    expect(responses[i].headers.get('x-request-id')).toBe(ids[i]);
    expect(await responses[i].json()).toMatchObject({ requestId: ids[i], code: 'internal_error' });
    expect(lines.map((line) => JSON.parse(line)).filter((line) => line.requestId === ids[i] && line.event === 'background.failed')).toHaveLength(1);
  }
  expect(lines.join('')).not.toContain('secret');
  withTrace({ taskId: 'task' }, () => traceEvent('test.task'));
});

it('retains transport evidence for non-JSON 503s without leaking the body or query', async () => {
  const result = await evalRequest('https://test', 'POST', '/api/run?paymentKey=secret', {}, async () => new Response('<html>secret-key</html>', { status: 503, headers: { 'cf-ray': 'ray-ICN', 'content-type': 'text/html' } }));
  expect(result.data.error).toContain('HTTP 503; non-JSON');
  expect(result.transport).toMatchObject({ status: 503, path: '/api/run', cfRay: 'ray-ICN', json: false });
  expect(JSON.stringify(result)).not.toContain('secret');
});

it('preserves streamed bodies and correlation headers', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const handler = traceRequest('/api/stream', async () => new Response(new ReadableStream({
    async start(controller) { await Promise.resolve(); controller.enqueue(new TextEncoder().encode('data: {"done":true}\n\n')); controller.close(); },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  const response = await handler(new Request('https://test/api/stream'), undefined);
  expect(response.headers.get('x-request-id')).toBeTruthy();
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  expect(await response.text()).toBe('data: {"done":true}\n\n');
});
