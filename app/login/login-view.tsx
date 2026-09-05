'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, LoaderCircle, ShieldCheck } from 'lucide-react';
import { OrbitMark } from '@/components/orbit-mark';

/**
 * 로그인 화면.
 *
 * 버튼은 /api/auth/providers 가 알려주는 제공자만 보입니다(클라이언트 ID 가 설정된 것).
 * 회원가입 화면은 따로 없습니다 — OAuth 첫 로그인이 곧 가입이고, 그 사실을 아래에 적어 둡니다.
 * "Claude 로 로그인" 은 Anthropic 정책상 제3자 앱에서 금지라 두지 않습니다 (docs/auth-flow.md).
 */

type ProviderInfo = { id: 'google' | 'github'; label: string };
type ProvidersResponse = { mode: 'local' | 'oauth'; providers: ProviderInfo[] };

const ERROR_MESSAGE: Record<string, string> = {
  provider: '지원하지 않는 로그인 방식입니다.',
  denied: '제공자에서 로그인을 취소했습니다.',
  state: '로그인 요청이 만료됐거나 변조됐습니다. 다시 시도해 주세요.',
  exchange: '제공자 인증은 됐지만 프로필을 받아오지 못했습니다. 잠시 후 다시 시도해 주세요.',
};

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.5 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4-13.6-9.7l-7.8 6C6.5 42.6 14.6 48 24 48z" />
  </svg>;
}

function GitHubMark() {
  return <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>;
}

export function LoginView() {
  const [info, setInfo] = useState<ProvidersResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');

  // oxlint-disable-next-line react/react-compiler -- 서버가 알려주는 제공자 목록을 마운트 후 한 번 읽습니다
  useEffect(() => {
    void (async () => {
      const code = new URLSearchParams(window.location.search).get('error');
      try {
        const r = await fetch('/api/auth/providers');
        if (!r.ok) throw new Error();
        setInfo(await r.json() as ProvidersResponse);
      } catch { setFailed(true); }
      if (code) setError(ERROR_MESSAGE[code] ?? '로그인에 실패했습니다.');
    })();
  }, []);

  return <main className="login-page">
    {/* oxlint-disable-next-line next/no-html-link-for-pages -- 로그인→랜딩은 다른 레이아웃 트리라 전체 로드가 맞습니다 */}
    <a className="login-brand" href="/landing"><span className="brand-mark"><OrbitMark size={26} /></span><b>orbitcrew</b></a>

    <section className="login-card">
      <span className="section-kicker">Sign in</span>
      <h1>orbitcrew 에 들어가기</h1>
      <p className="login-lead">프로젝트 매니저 에이전트가 팀을 꾸리고, 일을 나누고, 결과를 검토해 보고합니다.</p>

      {error ? <p className="login-error" role="alert">{error}</p> : null}

      {!info && !failed ? <p className="login-loading"><LoaderCircle className="spin" size={16} /> 로그인 방법을 불러오는 중</p> : null}
      {failed ? <p className="login-error">로그인 방법을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p> : null}

      {info?.mode === 'local' ? <div className="login-local">
        <p><ShieldCheck size={14} /> 이 서버는 로컬 전용 모드입니다. 로그인 없이 바로 들어갑니다.</p>
        {/* oxlint-disable-next-line next/no-html-link-for-pages -- 위와 같은 이유 */}
        <a className="login-button primary" href="/">앱 열기 <ArrowRight size={16} /></a>
      </div> : null}

      {info?.mode === 'oauth' ? <div className="login-providers">
        {info.providers.length === 0
          ? <p className="login-error">설정된 로그인 제공자가 없습니다. GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID 를 확인하세요.</p>
          : info.providers.map((p) => <a className="login-button" href={`/api/auth/login/${p.id}`} key={p.id}>
              {p.id === 'google' ? <GoogleMark /> : <GitHubMark />}
              {p.label} 계정으로 계속
            </a>)}
        <p className="login-note">처음이면 계정이 자동으로 만들어집니다. 별도 회원가입은 없습니다.</p>
      </div> : null}
    </section>

    <p className="login-foot">
      로그인하면 <b>체험 크레딧 300</b>이 지급되어 바로 시작할 수 있습니다. 본인 Anthropic API 키가 있다면 연결해서 무료로 쓸 수 있고, Anthropic 정책상 Claude 계정 로그인은 제공하지 않습니다.
    </p>
  </main>;
}
