/**
 * 로컬 에이전트(public/agent/orbitcrew-agent.ps1) 연결.
 * 브라우저는 탐색기를 직접 띄울 수 없으므로, 사용자 PC 에서 127.0.0.1:47831 로 듣는 작은 에이전트가 대신 엽니다.
 * 요청은 GET 뿐이고 응답은 JSON 입니다. 에이전트가 없으면 fetch 가 바로 실패하므로 설치 안내로 넘어갑니다.
 */
export const LOCAL_AGENT_PORT = 47831;
export const LOCAL_AGENT_URL = `http://127.0.0.1:${LOCAL_AGENT_PORT}`;
export const LOCAL_AGENT_INSTALL_COMMAND = 'irm https://app.orbitcrew.ai/agent/install.ps1 | iex';

export type LocalAgentInfo = { version: string; platform: string };
export type LocalAgentOpenResult = { ok: true; path?: string } | { ok: false; error: string };

async function callAgent<T>(path: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${LOCAL_AGENT_URL}${path}`, { mode: 'cors', signal: controller.signal, cache: 'no-store' });
    return await response.json() as T;
  } finally { clearTimeout(timer); }
}

/** 에이전트가 떠 있으면 버전을, 아니면 null 을 돌려줍니다. */
export async function pingLocalAgent(): Promise<LocalAgentInfo | null> {
  try {
    const data = await callAgent<{ ok?: boolean; version?: string; platform?: string }>('/ping', 1500);
    return data?.ok && typeof data.version === 'string' ? { version: data.version, platform: data.platform ?? 'unknown' } : null;
  } catch { return null; }
}

/**
 * 연결 폴더를 탐색기로 엽니다. 에이전트가 그 폴더의 실제 경로를 모르면 PC 에 폴더 선택창이 뜨므로 넉넉히 기다립니다.
 * 에이전트에 닿지 못하면 예외를 던집니다 — 호출 쪽에서 설치 안내로 분기하세요.
 */
export async function openFolderWithAgent(folderId: string, name: string): Promise<LocalAgentOpenResult> {
  const query = `folder=${encodeURIComponent(folderId)}&name=${encodeURIComponent(name)}`;
  const data = await callAgent<{ ok?: boolean; path?: string; error?: string }>(`/open?${query}`, 180_000);
  if (data?.ok) return { ok: true, path: data.path };
  return { ok: false, error: data?.error ?? 'unknown' };
}

export function isWindowsBrowser(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
}
