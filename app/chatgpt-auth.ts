import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type ChatGPTUser = { userId: string; displayName: string; email: string; fullName: string | null };

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get('oai-authenticated-user-id');
  const email = requestHeaders.get('oai-authenticated-user-email');
  if (!userId || !email) return null;
  const encodedName = requestHeaders.get('oai-authenticated-user-full-name');
  const fullName = encodedName && requestHeaders.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8' ? safeDecode(encodedName) : null;
  return { userId, email, fullName, displayName: fullName ?? email };
}

export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;
  redirect(`/signin-with-chatgpt?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`);
}

export function chatGPTSignOutPath(returnTo = '/'): string {
  return `/signout-with-chatgpt?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

function safeReturnTo(value: string) {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, 'https://app.local');
    if (url.origin !== 'https://app.local' || ['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'].includes(url.pathname)) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/'; }
}

function safeDecode(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}
