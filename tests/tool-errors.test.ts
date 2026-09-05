import { afterEach, expect, it, vi } from 'vitest';
import { runClaudeAgent, streamClaudeAgent } from '@/lib/claude';
afterEach(() => vi.unstubAllGlobals());
const tool = { type: 'tool_use', id: 'tool1', name: 'check', input: {} };

function sse(content: unknown[], reason: string) {
  const events = [
    { type: 'message_start', message: { id: 'm', model: 'test', usage: { input_tokens: 1 } } },
    ...content.flatMap((block, index) => [{ type: 'content_block_start', index, content_block: block }, { type: 'content_block_stop', index }]),
    { type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

it.each([false, true])('records structured errors and preserves approval success (stream=%s)', async (streaming) => {
  for (const raw of [{ error: 'denied' }, { ok: false }, { ok: true, pending_approval: 'id' }]) {
    const bodies: { messages: { content: unknown }[] }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      const content = bodies.length === 1 ? [tool] : [{ type: 'text', text: 'done' }];
      const stop_reason = bodies.length === 1 ? 'tool_use' : 'end_turn';
      return streaming ? sse(content, stop_reason) : Response.json({ id: 'm', content, stop_reason });
    }));
    const options = { apiKey: 'k', model: 'test', system: 's', messages: [{ role: 'user' as const, content: 'q' }], maxTokens: 20, executeTool: async () => raw, onDelta: () => {} };
    const result = await (streaming ? streamClaudeAgent(options) : runClaudeAgent(options));
    const error = 'error' in raw || raw.ok === false;
    expect(result.toolCalls[0].ok).toBe(!error);
    const message = bodies[1].messages.at(-1)?.content as { is_error?: boolean }[];
    expect(message[0].is_error).toBe(error ? true : undefined);
  }
});
