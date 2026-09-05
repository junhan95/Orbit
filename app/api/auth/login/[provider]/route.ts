import { appOrigin, authMode, authorizeUrl, configuredProviders, isProvider, isSecureOrigin, makeState, stateCookie } from '@/lib/auth';

type RouteContext = { params: Promise<{ provider: string }> | { provider: string } };

/** 제공자 인증 화면으로 보냅니다. state 는 서명해서 쿠키에도 넣어 콜백에서 대조합니다. */
export async function GET(request: Request, context: RouteContext) {
  const { provider } = await context.params;
  const origin = appOrigin(request);
  if (authMode() !== 'oauth') return Response.redirect(`${origin}/`, 302);
  if (!isProvider(provider) || !configuredProviders().includes(provider)) {
    return Response.redirect(`${origin}/login?error=provider`, 302);
  }
  const state = await makeState(provider);
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl(provider, state, origin),
      'Set-Cookie': stateCookie(state, isSecureOrigin(origin)),
    },
  });
}
