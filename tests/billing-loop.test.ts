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
  it('releases an acquired reservation if HTTP fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));
    const afterCall = vi.fn();
    await expect(callClaude({ apiKey: { apiKey: 'k', beforeCall: vi.fn(), afterCall }, model: 'm', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 10 })).rejects.toThrow('network failure');
    expect(afterCall).toHaveBeenCalledOnce();
  });
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


describe('worker output recovery', () => {
  const options = { apiKey: 'k', model: 'claude-sonnet-5', system: 's', messages: [{ role: 'user' as const, content: 'build' }], maxTokens: 8000, maxOutputRetries: 2 };
  const truncated = { ...endTurn, stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }, { type: 'tool_use', id: 'bad', name: 'noop', input: {} }] };
  it('retries truncated output without executing partial tools or retaining partial artifacts', async () => {
    const { bodies } = fakeFetch([truncated, endTurn]);
    const executeTool = vi.fn();
    const result = await runClaudeAgent({ ...options, executeTool });
    expect(result.stopReason).toBe('end_turn');
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.turns.map(t => t.text)).toEqual(['완료']);
    expect(result.usage.outputTokens).toBe(100);
    expect((bodies[1] as { max_tokens: number }).max_tokens).toBe(16000);
  });
  it('stops recovery when credits run out', async () => {
    const { bodies } = fakeFetch([truncated]);
    const result = await runClaudeAgent({ ...options, apiKey: { apiKey: 'k', onUsage: () => ({ stop: true }) } });
    expect(result.stopReason).toBe('insufficient_credits');
    expect(bodies).toHaveLength(1);
  });
  it('bounds retries and retains max_tokens failure', async () => {
    const { bodies } = fakeFetch([truncated, truncated, truncated]);
    const result = await runClaudeAgent(options);
    expect(result.stopReason).toBe('max_tokens');
    expect(bodies).toHaveLength(3);
  });
  it('delivers delegated code beyond generic tool clipping', async () => {
    const code = 'x'.repeat(20000);
    const { bodies } = fakeFetch([{ ...toolTurn, content: [{ type: 'tool_use', id: 'd', name: 'delegate_task', input: {} }] }, endTurn]);
    await runClaudeAgent({ ...options, executeTool: async () => ({ report: code }) });
    const request = bodies[1] as { messages: Array<{ content: Array<{ content: string }> }> };
    expect(request.messages.at(-1)?.content[0].content).toBe(JSON.stringify({ report: code }));
  });
});
