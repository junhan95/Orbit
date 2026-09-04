import { getChatGPTUser } from '@/app/chatgpt-auth';

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  return Response.json({ displayName: user.displayName, email: user.email });
}
