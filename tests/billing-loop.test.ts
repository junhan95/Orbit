import { afterEach, describe, expect, it, vi } from 'vitest';
import { callClaude, runClaudeAgent, type ClaudeBilling, type ClaudeUsage } from '@/lib/claude';

/** Anthropic 응답 흉내: tool_use 한 번 → end_turn */
function fakeFetch(responses: unknown[]) {
  const bodies: unknown[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(init?.body as string));
    const next = responses.shift();
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, bodies };
}

const usage = { input_tokens: 100, output_tokens: 50 };
const toolTurn = { id: 'm1', model: 'claude-sonnet-5', stop_reason: 'tool_use', usage, content: [{ type: 'text', text: '찾아보겠습니다' }, { type: 'tool_use', id: 't1', name: 'noop', input: {} }] };
const endTurn = { id: 'm2', model: 'claude-sonnet-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: '완료' }] };

afterEach(() => { vi.unstubAllGlobals(); });

describe('과금 핸들 (lib/claude.ts ClaudeBilling)', () => {
  it('문자열 키는 예전과 똑같이 동작', async () => {
    const { bodies } = fakeFetch([structuredClone(toolTurn), structuredClone(endTurn)]);
    const result = await runClaudeAgent({ apiKey: 'sk-ant-x', model: 'claude-sonnet-5', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 100, tools: [{ name: 'noop', description: '', input_schema: { type: 'object' } }], executeTool: async () => 'ok' });
    expect(result.stopReason).toBe('end_turn');
    expect(result.iterations).toBe(2);
    expect(bodies).toHaveLength(2);
  });

  it('onUsage 가 stop 을 돌려주면 툴 결과를 이어 보내지 않고 insufficient_credits 로 멈춤', async () => {
    const { bodies } = fakeFetch([structuredClone(toolTurn), structuredClone(endTurn)]);
    const seen: Array<{ model: string; usage: ClaudeUsage }> = [];
    const billing: ClaudeBilling = {
      apiKey: 'sk-ant-operator',
      onUsage: (model, u) => { seen.push({ model, usage: u }); return { stop: true }; },
    };
    const result = await runClaudeAgent({ apiKey: billing, model: 'claude-sonnet-5', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 100, tools: [{ name: 'noop', description: '', input_schema: { type: 'object' } }], executeTool: async () => 'ok' });
    expect(result.stopReason).toBe('insufficient_credits');
    expect(result.iterations).toBe(1);
    expect(result.text).toBe('찾아보겠습니다');
    expect(bodies).toHaveLength(1);
    expect(seen).toEqual([{ model: 'claude-sonnet-5', usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, webSearchRequests: 0 } }]);
  });

  it('resolveModel 로 바꾼 모델이 실제 요청에 실리고, 키는 핸들의 apiKey 를 씀', async () => {
    const { fetchMock, bodies } = fakeFetch([structuredClone(endTurn)]);
    const billing: ClaudeBilling = { apiKey: 'sk-ant-operator', resolveModel: () => 'claude-haiku-4-5' };
    await callClaude({ apiKey: billing, model: 'claude-fable-5-1', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 100 });
    expect((bodies[0] as { model: string }).model).toBe('claude-haiku-4-5');
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-operator');
  });

  it('beforeCall 이 던지면 호출 자체가 나가지 않음', async () => {
    const { bodies } = fakeFetch([structuredClone(endTurn)]);
    const billing: ClaudeBilling = { apiKey: 'k', beforeCall: () => { throw new Error('잔액 없음'); } };
    await expect(callClaude({ apiKey: billing, model: 'claude-sonnet-5', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 10 })).rejects.toThrow('잔액 없음');
    expect(bodies).toHaveLength(0);
  });
});
