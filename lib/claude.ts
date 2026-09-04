/**
 * Anthropic Messages API 클라이언트.
 * Cloudflare Workers 런타임의 표준 fetch 만 사용하므로 별도 SDK 의존성이 없습니다.
 */
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const WEB_SEARCH_TOOL = 'web_search_20250305';

export type ClaudeMessage = { role: 'user' | 'assistant'; content: string };
export type ClaudeUsage = {
  inputTokens: number; outputTokens: number;
  cacheCreationTokens: number; cacheReadTokens: number;
  webSearchRequests: number;
};
export type ClaudeResult = { id: string | null; model: string; text: string; stopReason: string | null; usage: ClaudeUsage };

type ContentBlock = { type: string; text?: string };
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

  const payload: Record<string, unknown> = {
    model: options.model,
    max_tokens: options.maxTokens,
    system: options.system,
    messages,
  };
  if (options.webSearchMaxUses && options.webSearchMaxUses > 0) {
    payload.tools = [{ type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: options.webSearchMaxUses }];
  }

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

  // 응답에는 웹 검색 도구 호출/결과 블록이 섞여 오므로 텍스트 블록만 모읍니다.
  const text = (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => (block.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
  if (!text) throw new Error('Claude가 결과를 반환하지 못했습니다.');

  return {
    id: data.id ?? null,
    model: data.model || options.model,
    text,
    stopReason: data.stop_reason ?? null,
    usage: readUsage(data.usage),
  };
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

/**
 * Messages API는 첫 메시지가 user 여야 하고 같은 role 이 연속되면 안 됩니다.
 * 저장된 대화 이력을 잘라서 보낼 때 이 조건이 깨질 수 있어 여기서 정규화합니다.
 */
export function normalizeMessages(rows: ClaudeMessage[]): ClaudeMessage[] {
  const cleaned = rows.filter((row) => row.content.trim().length > 0);
  let start = 0;
  while (start < cleaned.length && cleaned[start].role !== 'user') start += 1;

  const merged: ClaudeMessage[] = [];
  for (const message of cleaned.slice(start)) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content = `${last.content}\n\n${message.content}`;
    } else {
      merged.push({ role: message.role, content: message.content });
    }
  }
  return merged;
}
