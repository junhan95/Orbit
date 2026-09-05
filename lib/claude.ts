/**
 * Anthropic Messages API 클라이언트.
 * Cloudflare Workers 런타임의 표준 fetch 만 사용하므로 별도 SDK 의존성이 없습니다.
 *
 * - callClaude(): 단발 호출 (툴 없음)
 * - runClaudeAgent(): tool_use 루프 — 클라이언트 툴을 실행해 tool_result 를 돌려주며
 *   end_turn 까지 반복합니다. Hermes 의 에이전트 루프에서 필요한 최소 골격만 옮겼습니다.
 */
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const WEB_SEARCH_TOOL = 'web_search_20250305';
/** tool_result 로 되돌려 주는 문자열 상한. 검색 결과가 컨텍스트를 삼키지 않게 합니다. */
const TOOL_RESULT_MAX_CHARS = 12_000;

/** content 가 배열이면 Anthropic 콘텐츠 블록(text·image·document)을 그대로 보냅니다 — 대화 첨부에 씁니다. */
export type ClaudeMessage = { role: 'user' | 'assistant'; content: string | unknown[] };
export type ClaudeUsage = {
  inputTokens: number; outputTokens: number;
  cacheCreationTokens: number; cacheReadTokens: number;
  webSearchRequests: number;
};
export type ClaudeResult = { id: string | null; model: string; text: string; stopReason: string | null; usage: ClaudeUsage };

export type ToolDefinition = { name: string; description: string; input_schema: Record<string, unknown> };
export type ToolInput = Record<string, unknown>;
/** 툴 실행기. 문자열이나 JSON 직렬화 가능한 값을 돌려주면 그대로 tool_result 가 됩니다. 예외를 던지면 is_error 로 전달됩니다. */
export type ToolExecutor = (name: string, input: ToolInput) => Promise<unknown>;
export type ToolCallTrace = { name: string; input: ToolInput; ok: boolean; chars: number };
export type AgentTurn = { text: string; toolNames: string[] };
/** text 는 마지막 응답의 텍스트, turns 에는 반복마다의 텍스트와 그 턴에서 호출한 툴 이름이 순서대로 담깁니다. */
export type AgentRunResult = ClaudeResult & { iterations: number; toolCalls: ToolCallTrace[]; turns: AgentTurn[]; usagePerIteration: ClaudeUsage[] };

type ContentBlock = {
  type: string; text?: string;
  id?: string; name?: string; input?: ToolInput;
};
type ApiUsage = {
  input_tokens?: number; output_tokens?: number;
  cache_creation_input_tokens?: number; cache_read_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
};
type MessagesResponse = {
  id?: string;
  model?: string;
  content?: ContentBlock[];
  usage?: ApiUsage;
  stop_reason?: string;
  error?: { message?: string };
};
type ApiMessage = { role: 'user' | 'assistant'; content: string | unknown[] };

type RequestOptions = {
  apiKey: string; model: string; system: string; maxTokens: number;
  tools?: unknown[];
};

const CACHE_CONTROL = { type: 'ephemeral' } as const;

/**
 * 프롬프트 캐싱 (Hermes 의 "캐시 친화 설계"에서 가져온 부분).
 * - 시스템 프롬프트 블록에 고정 브레이크포인트 → tools + system 프리픽스가 한 실행 안에서 재사용됩니다.
 * - 마지막 user 메시지의 마지막 블록에 굴러가는 브레이크포인트 → 툴 루프에서 직전 반복까지의
 *   대화(assistant tool_use + tool_result)가 캐시 읽기(입력 단가의 1/10)로 잡힙니다.
 *   이전 반복에 찍어 둔 표시는 매번 지워 브레이크포인트가 4개를 넘지 않게 합니다.
 * - 모델별 최소 길이(Sonnet 5: 1,024토큰) 미만이면 조용히 무시되므로 짧은 대화에는 영향이 없습니다.
 */
function withCacheBreakpoints(messages: ApiMessage[]): ApiMessage[] {
  const stripped: ApiMessage[] = messages.map((message) => ({
    role: message.role,
    content: typeof message.content === 'string'
      ? message.content
      : message.content.map((block) => {
          if (block && typeof block === 'object' && 'cache_control' in (block as Record<string, unknown>)) {
            const { cache_control: _dropped, ...rest } = block as Record<string, unknown>;
            return rest;
          }
          return block;
        }),
  }));
  for (let index = stripped.length - 1; index >= 0; index -= 1) {
    const message = stripped[index];
    if (message.role !== 'user') continue;
    if (typeof message.content === 'string') {
      message.content = [{ type: 'text', text: message.content, cache_control: CACHE_CONTROL }];
    } else if (message.content.length) {
      const last = message.content[message.content.length - 1] as Record<string, unknown>;
      message.content[message.content.length - 1] = { ...last, cache_control: CACHE_CONTROL };
    }
    break;
  }
  return stripped;
}

function buildPayload(options: RequestOptions, messages: ApiMessage[], stream: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: options.model,
    max_tokens: options.maxTokens,
    system: [{ type: 'text', text: options.system, cache_control: CACHE_CONTROL }],
    messages: withCacheBreakpoints(messages),
  };
  if (options.tools?.length) payload.tools = options.tools;
  if (stream) payload.stream = true;
  return payload;
}

async function requestMessages(options: RequestOptions, messages: ApiMessage[]): Promise<MessagesResponse> {
  const payload = buildPayload(options, messages, false);

  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': options.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json() as MessagesResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || `Claude API 호출에 실패했습니다. (HTTP ${response.status})`);
  }
  return data;
}

function textOf(blocks: ContentBlock[] | undefined): string {
  return (blocks ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => (block.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function readUsage(usage: ApiUsage | undefined): ClaudeUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    webSearchRequests: usage?.server_tool_use?.web_search_requests ?? 0,
  };
}

function addUsage(total: ClaudeUsage, delta: ClaudeUsage): ClaudeUsage {
  return {
    inputTokens: total.inputTokens + delta.inputTokens,
    outputTokens: total.outputTokens + delta.outputTokens,
    cacheCreationTokens: total.cacheCreationTokens + delta.cacheCreationTokens,
    cacheReadTokens: total.cacheReadTokens + delta.cacheReadTokens,
    webSearchRequests: total.webSearchRequests + delta.webSearchRequests,
  };
}

function webSearchTool(maxUses: number | undefined) {
  return maxUses && maxUses > 0 ? [{ type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: maxUses }] : [];
}

export async function callClaude(options: {
  apiKey: string;
  model: string;
  system: string;
  messages: ClaudeMessage[];
  maxTokens: number;
  /** 0 보다 크면 Claude 서버측 웹 검색 도구를 해당 횟수만큼 허용합니다. */
  webSearchMaxUses?: number;
}): Promise<ClaudeResult> {
  const messages = normalizeMessages(options.messages);
  if (!messages.length) throw new Error('Claude에 보낼 메시지가 없습니다.');

  const data = await requestMessages(
    { apiKey: options.apiKey, model: options.model, system: options.system, maxTokens: options.maxTokens, tools: webSearchTool(options.webSearchMaxUses) },
    messages,
  );
  const text = textOf(data.content);
  if (!text) throw new Error('Claude가 결과를 반환하지 못했습니다.');
  return { id: data.id ?? null, model: data.model || options.model, text, stopReason: data.stop_reason ?? null, usage: readUsage(data.usage) };
}

/**
 * tool_use 루프. 모델이 클라이언트 툴을 호출하면 executeTool 로 실행해 tool_result 를 붙여 재호출합니다.
 * - 서버 툴(web_search) 블록은 assistant content 에 그대로 남겨 다음 턴에 되돌려 줍니다 (암호화 컨텐츠 보존).
 * - 반복 상한에 걸리면 stopReason='max_iterations' 로 종료합니다.
 * - 반환 text 는 마지막 응답의 텍스트만 씁니다 ("검색해 보겠습니다" 류의 중간 발화는 버립니다).
 */
export async function runClaudeAgent(options: {
  apiKey: string;
  model: string;
  system: string;
  messages: ClaudeMessage[];
  maxTokens: number;
  tools?: ToolDefinition[];
  executeTool?: ToolExecutor;
  maxIterations?: number;
  webSearchMaxUses?: number;
}): Promise<AgentRunResult> {
  const initial = normalizeMessages(options.messages);
  if (!initial.length) throw new Error('Claude에 보낼 메시지가 없습니다.');

  const conversation: ApiMessage[] = initial.map((message) => ({ role: message.role, content: message.content }));
  const tools = [...webSearchTool(options.webSearchMaxUses), ...(options.tools ?? [])];
  const request: RequestOptions = { apiKey: options.apiKey, model: options.model, system: options.system, maxTokens: options.maxTokens, tools };
  const maxIterations = Math.max(1, options.maxIterations ?? 8);

  let usage: ClaudeUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, webSearchRequests: 0 };
  const toolCalls: ToolCallTrace[] = [];
  let lastId: string | null = null;
  let lastModel = options.model;
  let lastText = '';
  let stopReason: string | null = null;
  const turns: AgentTurn[] = [];
  const usagePerIteration: ClaudeUsage[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const data = await requestMessages(request, conversation);
    usagePerIteration.push(readUsage(data.usage));
    usage = addUsage(usage, readUsage(data.usage));
    lastId = data.id ?? lastId;
    lastModel = data.model || lastModel;
    lastText = textOf(data.content);
    stopReason = data.stop_reason ?? null;

    const toolUses = (data.content ?? []).filter((block) => block.type === 'tool_use' && block.name && block.id);
    turns.push({ text: lastText, toolNames: toolUses.map((use) => use.name as string) });
    if (stopReason !== 'tool_use' || !toolUses.length) {
      return { id: lastId, model: lastModel, text: lastText, stopReason, usage, iterations: iteration, toolCalls, turns, usagePerIteration };
    }

    conversation.push({ role: 'assistant', content: data.content ?? [] });
    const results: unknown[] = [];
    for (const use of toolUses) {
      const name = use.name as string;
      const input = (use.input ?? {}) as ToolInput;
      let content: string;
      let isError = false;
      try {
        if (!options.executeTool) throw new Error(`툴 실행기가 없습니다: ${name}`);
        const raw = await options.executeTool(name, input);
        content = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
      } catch (error) {
        isError = true;
        content = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
      if (content.length > TOOL_RESULT_MAX_CHARS) {
        content = `${content.slice(0, TOOL_RESULT_MAX_CHARS)}\n…[${content.length - TOOL_RESULT_MAX_CHARS}자 잘림]`;
      }
      toolCalls.push({ name, input, ok: !isError, chars: content.length });
      results.push({ type: 'tool_result', tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
    }
    conversation.push({ role: 'user', content: results });
  }

  return { id: lastId, model: lastModel, text: lastText, stopReason: 'max_iterations', usage, iterations: maxIterations, toolCalls, turns, usagePerIteration };
}

// ── 스트리밍 ───────────────────────────────────────────────────────────────

export type StreamOptions = {
  apiKey: string;
  model: string;
  system: string;
  messages: ClaudeMessage[];
  maxTokens: number;
  /** 텍스트 조각이 도착할 때마다 호출됩니다. */
  onDelta: (text: string) => void;
  tools?: ToolDefinition[];
  executeTool?: ToolExecutor;
  maxIterations?: number;
  webSearchMaxUses?: number;
  /** 툴 호출이 시작될 때 알림 (UI 에 "과거 기록 검색 중…" 표시용) */
  onToolCall?: (name: string, input: ToolInput) => void;
};

type StreamEvent = {
  type: string;
  index?: number;
  message?: { id?: string; model?: string; usage?: ApiUsage };
  content_block?: ContentBlock & Record<string, unknown>;
  delta?: { type?: string; text?: string; partial_json?: string; thinking?: string; signature?: string; stop_reason?: string };
  usage?: ApiUsage;
  error?: { message?: string };
};

async function streamOnce(request: RequestOptions, messages: ApiMessage[], onDelta: (text: string) => void): Promise<MessagesResponse & { content: ContentBlock[] }> {
  const payload = buildPayload(request, messages, true);

  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: { 'x-api-key': request.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({})) as MessagesResponse;
    throw new Error(data.error?.message || `Claude API 호출에 실패했습니다. (HTTP ${response.status})`);
  }

  const blocks: (ContentBlock & Record<string, unknown>)[] = [];
  const partialJson: Record<number, string> = {};
  let id: string | undefined;
  let model: string | undefined;
  let usage: ApiUsage = {};
  let stopReason: string | undefined;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (event: StreamEvent) => {
    switch (event.type) {
      case 'message_start':
        id = event.message?.id; model = event.message?.model; usage = { ...usage, ...event.message?.usage };
        break;
      case 'content_block_start':
        if (event.index !== undefined && event.content_block) {
          const block = { ...event.content_block };
          if (block.type === 'text') block.text = block.text ?? '';
          // 생각(thinking) 블록은 서명까지 모아서 그대로 되돌려 보내야 툴 루프의 다음 요청이 거부되지 않습니다.
          if (block.type === 'thinking') block.thinking = block.thinking ?? '';
          blocks[event.index] = block;
        }
        break;
      case 'content_block_delta':
        if (event.index === undefined || !event.delta) break;
        if (event.delta.type === 'text_delta' && event.delta.text) {
          const block = blocks[event.index] ?? (blocks[event.index] = { type: 'text', text: '' });
          block.text = `${block.text ?? ''}${event.delta.text}`;
          onDelta(event.delta.text);
        } else if (event.delta.type === 'input_json_delta') {
          partialJson[event.index] = `${partialJson[event.index] ?? ''}${event.delta.partial_json ?? ''}`;
        } else if (event.delta.type === 'thinking_delta') {
          const block = blocks[event.index] ?? (blocks[event.index] = { type: 'thinking', thinking: '' });
          block.thinking = `${(block.thinking as string | undefined) ?? ''}${event.delta.thinking ?? ''}`;
        } else if (event.delta.type === 'signature_delta') {
          const block = blocks[event.index];
          if (block) block.signature = `${(block.signature as string | undefined) ?? ''}${event.delta.signature ?? ''}`;
        }
        break;
      case 'content_block_stop':
        if (event.index !== undefined && blocks[event.index]?.type === 'tool_use') {
          const raw = partialJson[event.index] ?? '';
          try { blocks[event.index].input = raw ? JSON.parse(raw) as ToolInput : {}; } catch { blocks[event.index].input = {}; }
        }
        break;
      case 'message_delta':
        stopReason = event.delta?.stop_reason ?? stopReason;
        if (event.usage) usage = { ...usage, ...event.usage };
        break;
      case 'error':
        throw new Error(event.error?.message || 'Claude 스트리밍 중 오류가 발생했습니다.');
      default:
        break;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        handle(JSON.parse(data) as StreamEvent);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  return { id, model, content: blocks.filter(Boolean), usage, stop_reason: stopReason };
}

/**
 * 스트리밍 + 툴 루프. onDelta 로 텍스트 조각을 흘려보내며, 모델이 툴을 부르면 실행해 이어 갑니다.
 * 툴이 없으면 단순 스트리밍과 동일하게 동작합니다.
 */
export async function streamClaudeAgent(options: StreamOptions): Promise<AgentRunResult> {
  const initial = normalizeMessages(options.messages);
  if (!initial.length) throw new Error('Claude에 보낼 메시지가 없습니다.');

  const conversation: ApiMessage[] = initial.map((message) => ({ role: message.role, content: message.content }));
  const tools = [...webSearchTool(options.webSearchMaxUses), ...(options.tools ?? [])];
  const request: RequestOptions = { apiKey: options.apiKey, model: options.model, system: options.system, maxTokens: options.maxTokens, tools };
  const maxIterations = Math.max(1, options.maxIterations ?? 4);

  let usage: ClaudeUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, webSearchRequests: 0 };
  const toolCalls: ToolCallTrace[] = [];
  let lastId: string | null = null;
  let lastModel = options.model;
  let text = '';
  const turns: AgentTurn[] = [];
  const usagePerIteration: ClaudeUsage[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const data = await streamOnce(request, conversation, options.onDelta);
    usagePerIteration.push(readUsage(data.usage));
    usage = addUsage(usage, readUsage(data.usage));
    lastId = data.id ?? lastId;
    lastModel = data.model || lastModel;
    // 스트리밍은 중간 발화도 이미 사용자에게 흘러갔으므로 전체를 이어 붙입니다.
    const chunk = textOf(data.content);
    if (chunk) text = text ? `${text}\n\n${chunk}` : chunk;
    const stopReason = data.stop_reason ?? null;

    const toolUses = data.content.filter((block) => block.type === 'tool_use' && block.name && block.id);
    turns.push({ text: chunk, toolNames: toolUses.map((use) => use.name as string) });
    if (stopReason !== 'tool_use' || !toolUses.length) {
      return { id: lastId, model: lastModel, text, stopReason, usage, iterations: iteration, toolCalls, turns, usagePerIteration };
    }

    conversation.push({ role: 'assistant', content: data.content });
    const results: unknown[] = [];
    for (const use of toolUses) {
      const name = use.name as string;
      const input = (use.input ?? {}) as ToolInput;
      options.onToolCall?.(name, input);
      let content: string;
      let isError = false;
      try {
        if (!options.executeTool) throw new Error(`툴 실행기가 없습니다: ${name}`);
        const raw = await options.executeTool(name, input);
        content = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
      } catch (error) {
        isError = true;
        content = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
      if (content.length > TOOL_RESULT_MAX_CHARS) content = `${content.slice(0, TOOL_RESULT_MAX_CHARS)}\n…[${content.length - TOOL_RESULT_MAX_CHARS}자 잘림]`;
      toolCalls.push({ name, input, ok: !isError, chars: content.length });
      results.push({ type: 'tool_result', tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
    }
    conversation.push({ role: 'user', content: results });
  }
  return { id: lastId, model: lastModel, text, stopReason: 'max_iterations', usage, iterations: maxIterations, toolCalls, turns, usagePerIteration };
}

/** 툴 없는 단순 스트리밍 (app/api/chat/stream 이 사용) */
export async function streamClaude(options: Omit<StreamOptions, 'tools' | 'executeTool' | 'maxIterations' | 'onToolCall'>): Promise<ClaudeResult> {
  const result = await streamClaudeAgent(options);
  if (!result.text) throw new Error('Claude가 결과를 반환하지 못했습니다.');
  return result;
}

/**
 * Messages API는 첫 메시지가 user 여야 하고 같은 role 이 연속되면 안 됩니다.
 * 저장된 대화 이력을 잘라서 보낼 때 이 조건이 깨질 수 있어 여기서 정규화합니다.
 */
export function normalizeMessages(rows: ClaudeMessage[]): ClaudeMessage[] {
  const cleaned = rows.filter((row) => (typeof row.content === 'string' ? row.content.trim().length > 0 : row.content.length > 0));
  let start = 0;
  while (start < cleaned.length && cleaned[start].role !== 'user') start += 1;

  const merged: ClaudeMessage[] = [];
  for (const message of cleaned.slice(start)) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content = typeof last.content === 'string' && typeof message.content === 'string'
        ? `${last.content}\n\n${message.content}`
        : [...toBlocks(last.content), ...toBlocks(message.content)];
    } else {
      merged.push({ role: message.role, content: message.content });
    }
  }
  return merged;
}

/** 문자열이든 블록 배열이든 블록 배열로 맞춥니다 (같은 role 이 연속될 때 합치는 용도). */
function toBlocks(content: string | unknown[]): unknown[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

/** 블록 배열이 섞여 있어도 글자만 뽑습니다 — 길이 검사·요약처럼 텍스트만 필요할 때 씁니다. */
export function messageText(content: string | unknown[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => {
      if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
        const text = (block as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}
