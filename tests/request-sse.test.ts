import { afterEach, expect, it, vi } from 'vitest';
import { runClaudeAgent } from '@/lib/claude';
afterEach(() => vi.unstubAllGlobals());

function sse(text: string) {
  const events = [
    { type: 'message_start', message: { id: 'm1', model: 'test', usage: { input_tokens: 3 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...text.split(' ').map((word, i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: (i ? ' ' : '') + word } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

// 긴 출력이 API 앞단의 100초 제한(524)에 걸리지 않도록, 비스트리밍 경로도 서버 안에서는 SSE 로 받습니다.
it('runClaudeAgent requests a stream and assembles the full message from SSE', async () => {
  const bodies: { stream?: boolean }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => { bodies.push(JSON.parse(init.body)); return sse('hello from the stream'); }));
  const result = await runClaudeAgent({ apiKey: 'k', model: 'test', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 20 });
  expect(bodies[0].stream).toBe(true);
  expect(result.text).toBe('hello from the stream');
  expect(result.stopReason).toBe('end_turn');
  expect(result.usage.inputTokens).toBe(3);
  expect(result.usage.outputTokens).toBe(7);
});

it('runClaudeAgent still accepts a plain JSON response', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'm2', model: 'test', content: [{ type: 'text', text: 'json ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } })));
  const result = await runClaudeAgent({ apiKey: 'k', model: 'test', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 20 });
  expect(result.text).toBe('json ok');
  expect(result.usage.outputTokens).toBe(2);
});
