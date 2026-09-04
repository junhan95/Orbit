import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDatabase, getRuntimeConfig } from '@/db';

type ChatRow = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number };
type OpenAIResponse = { id?: string; output_text?: string; error?: { message?: string } };

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  const agentId = url.searchParams.get('agentId');
  if (!projectId || !agentId) return Response.json({ messages: [] });
  const messages = await getDatabase().prepare('SELECT id, role, content, created_at AS createdAt FROM chat_messages WHERE user_id = ? AND project_id = ? AND agent_id = ? ORDER BY created_at ASC LIMIT 100').bind(user.userId, projectId, agentId).all<ChatRow>();
  return Response.json({ messages: messages.results });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { projectId?: unknown; agentId?: unknown; message?: unknown } | null;
  if (typeof body?.projectId !== 'string' || typeof body.agentId !== 'string' || typeof body.message !== 'string' || !body.message.trim()) return Response.json({ error: '프로젝트, 에이전트, 메시지가 필요합니다.' }, { status: 400 });
  const message = body.message.trim().slice(0, 4000);
  const db = getDatabase();
  const context = await db.prepare('SELECT p.name AS projectName, p.description AS projectDescription, a.name AS agentName, a.role AS agentRole, a.instructions AS instructions FROM projects p JOIN project_agents pa ON pa.project_id = p.id AND pa.user_id = p.user_id JOIN agents a ON a.id = pa.agent_id AND a.user_id = p.user_id WHERE p.id = ? AND a.id = ? AND p.user_id = ?').bind(body.projectId, body.agentId, user.userId).first<Record<string, string>>();
  if (!context) return Response.json({ error: '이 프로젝트에 배정된 에이전트가 아닙니다.' }, { status: 403 });

  const userMessage: ChatRow = { id: crypto.randomUUID(), role: 'user', content: message, createdAt: Date.now() };
  await db.prepare('INSERT INTO chat_messages (id, user_id, project_id, agent_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(userMessage.id, user.userId, body.projectId, body.agentId, 'user', message, userMessage.createdAt).run();
  const { apiKey, model } = getRuntimeConfig();
  if (!apiKey) return Response.json({ error: 'OpenAI API 연결이 아직 설정되지 않았습니다.', userMessage }, { status: 503 });

  const history = await db.prepare('SELECT role, content FROM chat_messages WHERE user_id = ? AND project_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT 12').bind(user.userId, body.projectId, body.agentId).all<{ role: string; content: string }>();
  const input = history.results.reverse().map((item) => ({ role: item.role, content: item.content }));
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, instructions: `당신은 ${context.agentName}, ${context.agentRole}입니다. ${context.instructions}\n현재 프로젝트: ${context.projectName}\n프로젝트 설명: ${context.projectDescription}`, input, max_output_tokens: 1000, store: false, safety_identifier: await safetyId(user.userId) }),
    });
    const data = await response.json() as OpenAIResponse;
    if (!response.ok || !data.output_text) throw new Error(data.error?.message || '답변을 생성하지 못했습니다.');
    const assistantMessage: ChatRow = { id: crypto.randomUUID(), role: 'assistant', content: data.output_text, createdAt: Date.now() };
    await db.prepare('INSERT INTO chat_messages (id, user_id, project_id, agent_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(assistantMessage.id, user.userId, body.projectId, body.agentId, 'assistant', assistantMessage.content, assistantMessage.createdAt).run();
    return Response.json({ userMessage, assistantMessage });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '답변 생성에 실패했습니다.', userMessage }, { status: 502 });
  }
}

async function safetyId(userId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((value) => value.toString(16).padStart(2, '0')).join('');
}
