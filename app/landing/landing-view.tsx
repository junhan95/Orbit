'use client';

import { useState } from 'react';

/**
 * Orbit 랜딩페이지.
 *
 * 레이아웃 문법은 Targo 히어로 스펙(계단식 헤드라인, 챔퍼 코너 버튼, 왼쪽 스크림 +
 * 오른쪽 비주얼, 오른쪽 여백 없는 어바웃 2단)을 그대로 따르고,
 * 색·폰트는 앱 디자인 시스템(DESIGN-airtable.md 의 --c-* 토큰)으로 맞췄습니다.
 *
 * 스타일은 globals.css 를 건드리지 않도록 이 파일 안에 가둡니다(.lp 스코프).
 * 토큰이 없는 환경(정적 미리보기)에서도 열리도록 모든 var() 에 폴백을 둡니다.
 */

const NAV_LINKS = [
  ['기능', '#features'],
  ['작동 방식', '#how'],
  ['시작하기', '#cta'],
] as const;

const FEATURES = [
  {
    k: '01',
    t: '프로젝트 매니저',
    d: '프로젝트를 만들면 전용 매니저가 배정됩니다. 지시를 읽고 필요한 직무의 에이전트를 합류시키고, 업무를 나누고, 보고를 모아 정리해 돌려줍니다.',
  },
  {
    k: '02',
    t: '4층 기억',
    d: '사용자·프로젝트·에이전트 기억을 문자 예산 안에서 관리합니다. 턴 시작에 동결하고, 실행이 끝나면 리뷰가 돌며, 프로젝트 기억은 사람 승인을 거칩니다.',
  },
  {
    k: '03',
    t: '회상',
    d: '지난 실행과 대화를 FTS5 로 되찾습니다. 한국어 두 글자 단어까지 바이그램으로 잡고, 실행당 호출 횟수에 상한을 둬 비용이 새지 않습니다.',
  },
  {
    k: '04',
    t: '검증된 완료',
    d: '에이전트는 근거를 붙여야 완료로 보고할 수 있습니다. 근거가 없으면 카드에 표시가 남고, 다른 에이전트가 버그·스펙·정책·근거 네 패스로 검토합니다.',
  },
  {
    k: '05',
    t: '승인 게이트',
    d: '카드를 많이 만들거나 전역 스킬을 저장하려 하면 승인 큐로 넘어갑니다. 연속 실패는 서킷브레이커가 끊고, 사람 댓글이 다시 풀어줍니다.',
  },
  {
    k: '06',
    t: '관제 밴드',
    d: '실패·막힘·근거 누락·게이트 차단·실행당 비용을 14일 기준선과 비교합니다. 밴드를 벗어나면 매니저에게 진단 카드가 자동으로 올라갑니다.',
  },
];

const STEPS = [
  { n: '01', t: '목표를 말합니다', d: '대화창에 하고 싶은 일을 그대로 적습니다. 상태를 손으로 옮길 필요가 없습니다.' },
  { n: '02', t: '매니저가 팀을 짭니다', d: '직무 카탈로그에서 필요한 에이전트를 부르고, 없으면 새로 만들어 프로젝트에 합류시킵니다.' },
  { n: '03', t: '에이전트가 실행합니다', d: '기억과 회상을 안고 일하고, 근거를 붙여 구조화된 완료 보고를 남깁니다.' },
  { n: '04', t: '검토하고 승인합니다', d: '작성자가 아닌 에이전트가 먼저 걸러내고, 마지막 판단만 사람이 합니다.' },
];

export function LandingView() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="lp">
      <style dangerouslySetInnerHTML={{ __html: LP_CSS }} />

      {/* ── Section 1 — Hero ───────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-visual" aria-hidden="true">
          <OrbitDiagram />
        </div>
        <div className="lp-scrim" aria-hidden="true" />

        <nav className="lp-nav">
          <a className="lp-logo" href="#top">
            <span className="lp-logo-mark">
              <span className="lp-logo-dot" />
            </span>
            <span className="lp-logo-word">orbit</span>
          </a>

          <div className="lp-nav-links">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href}>{label}</a>
            ))}
          </div>

          {/* oxlint-disable-next-line next/no-html-link-for-pages -- 랜딩→앱은 전체 로드가 맞습니다 */}
          <a className="lp-nav-cta" href="/login">
            <svg width="17" height="13" viewBox="0 0 17 13" fill="none" aria-hidden="true">
              <rect x="0.7" y="0.7" width="15.6" height="11.6" stroke="currentColor" strokeWidth="1.4" />
              <path d="M1 1.6L8.5 7.2L16 1.6" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            앱 열기
          </a>

          <button
            className="lp-burger"
            type="button"
            aria-label="메뉴"
            aria-controls="lp-mobile-menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span /><span /><span />
          </button>

          {/* 항상 렌더하고 hidden 으로 숨깁니다 — 정적 빌드(scripts/build-landing.mjs)에서는 작은 스크립트가 hidden 을 토글합니다 */}
          <div className="lp-mobile-menu" hidden={!menuOpen} id="lp-mobile-menu">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
            ))}
            {/* oxlint-disable-next-line next/no-html-link-for-pages -- 위와 같은 이유 */}
            <a href="/login" onClick={() => setMenuOpen(false)}>앱 열기</a>
          </div>
        </nav>

        <div className="lp-hero-body">
          <p className="lp-eyebrow">AI AGENT COMMAND CENTER</p>

          <h1 className="lp-h1">
            <span>ONE</span>
            <span>MANAGER</span>
            <span>RUNS</span>
            <span className="lp-in">YOUR</span>
            <span className="lp-in">WHOLE</span>
            <span className="lp-in lp-accent">TEAM</span>
          </h1>

          <p className="lp-hero-sub">
            프로젝트 하나에 매니저 한 명. 나머지는 매니저가 뽑고, 나누고, 받아냅니다.
          </p>

          <div className="lp-hero-cta">
            <a className="lp-btn" href="#cta">
              시작하기
              <i className="lp-btn-line" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Section 2 — About ──────────────────────────────── */}
      <section className="lp-about" id="about">
        <div className="lp-about-left">
          <h2 className="lp-h2">
            <span>ABOUT</span>
            <span className="lp-in2 lp-accent">ORBIT</span>
          </h2>
          <p className="lp-p">
            Orbit 은 AI 에이전트가 실제로 일을 끝내게 만드는 워크스페이스입니다. 기억하고, 지난 실행을
            되찾아 읽고, 근거를 붙여 보고하고, 서로의 결과를 검토합니다. 사람은 상태를 옮기지 않습니다.
            루프 위에서 승인하고, 거절하고, 방향만 잡습니다.
          </p>
          <a className="lp-btn lp-btn-ghost" href="#features">
            더 알아보기
            <i className="lp-btn-line" />
          </a>
        </div>

        <div className="lp-about-right" aria-hidden="true">
          <BoardDiagram />
          <div className="lp-tint" />
        </div>
      </section>

      {/* ── Section 3 — Features ───────────────────────────── */}
      <section className="lp-features" id="features">
        <header className="lp-sec-head">
          <p className="lp-eyebrow">CAPABILITIES</p>
          <h2 className="lp-h3">에이전트가 혼자 일해도 되는 이유</h2>
        </header>
        <div className="lp-grid">
          {FEATURES.map((f) => (
            <article key={f.k} className="lp-card">
              <span className="lp-card-k">{f.k}</span>
              <h3>{f.t}</h3>
              <p>{f.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Section 4 — How it works ───────────────────────── */}
      <section className="lp-how" id="how">
        <header className="lp-sec-head">
          <p className="lp-eyebrow lp-eyebrow-dim">HOW IT WORKS</p>
          <h2 className="lp-h3 lp-h3-inv">네 단계로 끝납니다</h2>
        </header>
        <ol className="lp-steps">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="lp-step-n">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Section 5 — CTA ────────────────────────────────── */}
      <section className="lp-cta" id="cta">
        <h2 className="lp-h2 lp-h2-center">
          <span>START</span>
          <span className="lp-in2 lp-accent">TODAY</span>
        </h2>
        <p className="lp-p lp-p-center">
          프로젝트 이름과 작업 폴더만 정하면, 매니저가 첫 업무를 만들어 옵니다.
        </p>
        {/* oxlint-disable-next-line next/no-html-link-for-pages -- 위와 같은 이유 */}
        <a className="lp-btn" href="/login">
          Orbit 열기
          <i className="lp-btn-line" />
        </a>
      </section>

      <footer className="lp-footer">
        <span className="lp-logo-word lp-footer-word">orbit</span>
        <span>AI Agent Command Center</span>
      </footer>
    </div>
  );
}

/** 히어로 비주얼 — 매니저 코어를 도는 에이전트 궤도. 영상 대신 쓰는 SVG. */
function OrbitDiagram() {
  return (
    <svg className="lp-orbit" viewBox="0 0 620 620" role="presentation">
      <defs>
        <radialGradient id="lpCore" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="var(--lp-core-1)" />
          <stop offset="100%" stopColor="var(--lp-core-2)" />
        </radialGradient>
      </defs>

      {[290, 230, 168, 106].map((r, i) => (
        <circle key={r} cx="310" cy="310" r={r} className="lp-ring" style={{ opacity: 0.14 + i * 0.07 }} />
      ))}

      <g className="lp-spin lp-spin-a">
        <circle cx="310" cy="20" r="13" className="lp-node lp-node-coral" />
        <circle cx="600" cy="310" r="9" className="lp-node lp-node-mint" />
        <circle cx="310" cy="600" r="11" className="lp-node lp-node-peach" />
      </g>
      <g className="lp-spin lp-spin-b">
        <circle cx="310" cy="80" r="10" className="lp-node lp-node-mustard" />
        <circle cx="540" cy="310" r="8" className="lp-node lp-node-coral" />
      </g>
      <g className="lp-spin lp-spin-c">
        <circle cx="310" cy="142" r="9" className="lp-node lp-node-mint" />
        <circle cx="478" cy="310" r="7" className="lp-node lp-node-peach" />
        <circle cx="310" cy="478" r="7" className="lp-node lp-node-coral" />
      </g>

      <circle cx="310" cy="310" r="66" fill="url(#lpCore)" />
      <circle cx="310" cy="310" r="66" className="lp-core-ring" />
      <circle cx="310" cy="310" r="90" className="lp-pulse" />
      <text x="310" y="305" className="lp-core-t1">MANAGER</text>
      <text x="310" y="325" className="lp-core-t2">orbit</text>
    </svg>
  );
}

/** 어바웃 비주얼 — 카드가 검토 열로 넘어가는 보드. */
function BoardDiagram() {
  const cols: { h: string; cards: { t: string; tag: string }[] }[] = [
    { h: '대기', cards: [{ t: '경쟁사 조사', tag: '높음' }, { t: '릴리스 노트', tag: '중간' }] },
    { h: '진행', cards: [{ t: '스키마 정리', tag: '높음' }] },
    { h: '검토', cards: [{ t: '온보딩 문서', tag: '중간' }, { t: '가격표 검증', tag: '낮음' }] },
  ];
  return (
    <div className="lp-board">
      {cols.map((c) => (
        <div key={c.h} className="lp-board-col">
          <p className="lp-board-h">{c.h}</p>
          {c.cards.map((card) => (
            <div key={card.t} className="lp-board-card">
              <span className="lp-board-t">{card.t}</span>
              <span className="lp-board-tag">{card.tag}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const LP_CSS = `
.lp{
  /* 앱과 같은 --c-* 토큰만 씁니다 (app/globals.css). 랜딩 전용 색을 따로 두지 않습니다. */
  --lp-bg:var(--c-app-bg,#ffffff);
  --lp-bg-2:var(--c-surface-soft,#f7f8fa);
  --lp-ink:var(--c-ink,#1c1c1e);
  --lp-text:var(--c-text,#2c2c34);
  --lp-muted:var(--c-text-muted,#555a6a);
  --lp-line:var(--c-line,#e0e2e8);
  --lp-line-soft:var(--c-line-soft,#eef0f3);
  --lp-line-strong:var(--c-line-mid,#c7cad5);
  --lp-card:var(--c-surface-card,#ffffff);
  --lp-brand:var(--c-brand,#ffd02f);
  --lp-brand-deep:var(--c-brand-deep,#fcb900);
  --lp-on-brand:var(--c-on-brand,#1c1c1e);
  --lp-blue:var(--c-link,#4262ff);
  --lp-teal:var(--c-mint,#0fbcb0);
  --lp-rose:#ffd8f4;
  --lp-coral-light:#ffc6c6;
  --lp-orange-light:#ffe6cd;
  --lp-inverse:var(--c-inverse,#1c1c1e);
  --lp-on-inverse:var(--c-on-inverse,#ffffff);
  --lp-cta:var(--primary,#1c1c1e);
  --lp-on-cta:var(--primary-foreground,#ffffff);
  --lp-core-1:#3a3a40;
  --lp-core-2:var(--c-inverse,#1c1c1e);
  --lp-indent:min(238px,28vw);
  --lp-gutter:clamp(20px,9vw,118px);
  --lp-r-full:var(--r-full,9999px);
  --lp-r-card:var(--r-xl,16px);
  --lp-r-feature:var(--r-xxxl,28px);
  font-family:var(--font-app,var(--font-app-sans),'Figtree','Pretendard','Noto Sans KR',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif);
  background:var(--lp-bg);
  color:var(--lp-text);
  -webkit-font-smoothing:antialiased;
}
.dark .lp{ --lp-core-1:#2e2e33; }
.lp *{ box-sizing:border-box; }
.lp a{ color:inherit; text-decoration:none; }

/* 공통 타이포 */
.lp-eyebrow{ margin:0 0 18px; font-size:11px; font-weight:600; letter-spacing:.5px; text-transform:uppercase; color:var(--lp-muted); }
.lp-eyebrow-dim{ color:var(--lp-brand); }
.lp-h1,.lp-h2{ margin:0; font-weight:500; letter-spacing:-.03em; line-height:1.05; color:var(--lp-ink); display:flex; flex-direction:column; }
.lp-h1{ font-size:min(clamp(38px,7.4vw,80px),9.4vh); }
.lp-h2{ font-size:clamp(34px,6vw,60px); letter-spacing:-.025em; }
.lp-in{ padding-left:var(--lp-indent); }
.lp-in2{ padding-left:min(160px,18vw); }
.lp-accent{ color:var(--lp-on-brand); background:var(--lp-brand); align-self:flex-start; padding:0 .22em; border-radius:var(--lp-r-card); }
.lp-h3{ margin:0; font-size:clamp(26px,3.2vw,36px); font-weight:500; letter-spacing:-.015em; line-height:1.2; color:var(--lp-ink); }
.lp-h3-inv{ color:var(--lp-on-inverse); }
.lp-p{ max-width:520px; font-size:clamp(14px,1.6vw,17px); line-height:1.75; color:var(--lp-muted); }

/* 버튼 — Miro 의 검정 알약(button-primary) / 테두리 알약(button-secondary) */
.lp .lp-btn{
  display:inline-flex; align-items:center; gap:12px;
  background:var(--lp-cta); border:1px solid transparent; color:var(--lp-on-cta);
  font-weight:500; letter-spacing:0; font-size:15px; line-height:1.3;
  padding:14px 28px; border-radius:var(--lp-r-full); cursor:pointer;
  transition:background .2s ease,transform .2s ease,box-shadow .2s ease;
}
.lp .lp-btn:hover{ background:var(--c-inverse-2,#2c2c34); transform:translateY(-1px); box-shadow:0 6px 18px -8px var(--c-shadow,#05003814); }
.lp-btn-line{ width:18px; height:1px; background:currentColor; display:block; opacity:.7; }
.lp .lp-btn-ghost{ background:transparent; border-color:var(--lp-line-strong); color:var(--lp-ink); box-shadow:none; }
.lp .lp-btn-ghost:hover{ background:var(--lp-bg-2); border-color:var(--lp-ink); box-shadow:none; }
.lp .lp-btn-brand{ background:var(--lp-brand); color:var(--lp-on-brand); border-color:transparent; }
.lp .lp-btn-brand:hover{ background:var(--lp-brand-deep); }

/* ── 히어로 ── */
.lp-hero{ position:relative; min-height:100svh; background:var(--lp-bg); overflow:hidden; display:flex; flex-direction:column; }
.lp-hero-visual{ position:absolute; top:52%; right:-12%; transform:translateY(-50%); width:min(76vh,720px); pointer-events:none; z-index:0; }
.lp-scrim{ position:absolute; inset:0 22% 0 0; z-index:1; pointer-events:none;
  background:linear-gradient(90deg,
    var(--lp-bg) 0%,var(--lp-bg) 46%,
    color-mix(in srgb,var(--lp-bg) 94%,transparent) 60%,
    color-mix(in srgb,var(--lp-bg) 78%,transparent) 72%,
    color-mix(in srgb,var(--lp-bg) 52%,transparent) 82%,
    color-mix(in srgb,var(--lp-bg) 24%,transparent) 91%,
    transparent 100%); }

.lp-nav{ position:relative; z-index:3; display:flex; flex-wrap:wrap; align-items:center; gap:clamp(20px,5vw,56px);
  padding:clamp(20px,3vw,38px) clamp(20px,4vw,48px) 0; }
.lp-logo{ display:flex; align-items:center; gap:12px; }
.lp-logo-mark{ width:38px; height:38px; border-radius:50%; background:var(--lp-inverse); display:grid; place-items:center; }
.lp-logo-dot{ width:20px; height:8px; border-radius:99px; background:#fff; transform:rotate(-25deg); display:block; }
.lp-logo-word{ font-size:clamp(22px,5vw,30px); font-weight:500; color:var(--lp-ink); letter-spacing:-.5px; }
.lp-nav-links{ display:flex; gap:34px; }
.lp-nav-links a{ font-weight:700; font-size:clamp(12px,2.4vw,15px); letter-spacing:.06em; color:var(--lp-text); white-space:nowrap; }
.lp-nav-links a:hover{ color:var(--lp-ink); }
.lp .lp-nav-cta{ margin-left:auto; display:inline-flex; align-items:center; gap:9px; background:transparent; border:0;
  color:var(--lp-ink); font-size:14px; font-weight:500; padding:12px 24px; cursor:pointer;
  border-radius:var(--lp-r-full); box-shadow:inset 0 0 0 1px var(--lp-line-strong); transition:background .2s ease; }
.lp .lp-nav-cta:hover{ background:color-mix(in srgb,var(--lp-ink) 8%,transparent); }
.lp-burger{ display:none; margin-left:auto; background:transparent; border:0; padding:8px; cursor:pointer; flex-direction:column; gap:5px; }
.lp-burger span{ width:22px; height:2px; background:var(--lp-ink); display:block; }
.lp-mobile-menu{ flex-basis:100%; display:flex; flex-direction:column; gap:18px; padding:22px 0 4px; }
.lp-mobile-menu[hidden]{ display:none; }
.lp-mobile-menu a{ font-weight:700; color:var(--lp-ink); }

.lp-hero-body{ position:relative; z-index:3; flex:1; display:flex; flex-direction:column; justify-content:center;
  padding:min(clamp(36px,8vw,110px),8vh) 20px min(clamp(36px,6vw,80px),7vh) var(--lp-gutter); }
.lp-hero-sub{ margin:min(28px,3.4vh) 0 0 var(--lp-indent); max-width:430px; font-size:clamp(14px,1.6vw,17px); line-height:1.7; color:var(--lp-muted); }
.lp-hero-cta{ padding:min(clamp(24px,4vw,44px),4.5vh) 0 0 var(--lp-indent); }

/* ── 어바웃 ── */
.lp-about{ display:flex; flex-wrap:wrap; align-items:center; gap:40px; position:relative;
  background:linear-gradient(180deg,var(--lp-bg) 0%,var(--lp-bg-2) 18%,var(--lp-bg-2) 100%);
  padding:clamp(60px,10vw,140px) 0 clamp(30px,5vw,70px) var(--lp-gutter); }
.lp-about-left{ flex:1 1 420px; min-width:300px; }
.lp-about-left .lp-p{ margin:32px 0 0 min(160px,18vw); }
.lp-about-left .lp-btn{ margin:36px 0 0 min(160px,18vw); }
.lp-about-right{ flex:1 1 360px; min-width:280px; position:relative; display:flex; justify-content:flex-end; overflow:hidden; }
.lp-tint{ position:absolute; inset:0; pointer-events:none; z-index:1;
  background:radial-gradient(120% 90% at 100% 50%,color-mix(in srgb,var(--lp-brand) 22%,transparent) 0%,transparent 70%); }

.lp-board{ width:100%; max-width:644px; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px;
  padding:26px 26px 26px 22px; background:var(--lp-card); border:1px solid var(--lp-line);
  border-right:0; box-shadow:-24px 24px 60px -34px var(--c-shadow,#05003814); }
.lp-board-col{ display:flex; flex-direction:column; gap:10px; }
.lp-board-h{ margin:0 0 2px; font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--lp-muted); }
.lp-board-card{ display:flex; flex-direction:column; gap:8px; padding:12px 13px; border:1px solid var(--lp-line);
  background:var(--lp-bg); border-radius:8px; }
.lp-board-t{ font-size:13px; font-weight:600; color:var(--lp-ink); }
.lp-board-tag{ align-self:flex-start; font-size:10px; font-weight:700; letter-spacing:.06em; padding:3px 8px; border-radius:99px;
  background:var(--c-cream,#fff4c4); color:var(--c-mustard-ink,#746019); }
.lp-board-col:last-child .lp-board-card{ border-color:var(--lp-line-strong); }

/* ── 기능 ── */
.lp-features{ background:var(--lp-bg-2); padding:clamp(70px,9vw,130px) var(--lp-gutter); }
.lp-sec-head{ max-width:620px; margin-bottom:clamp(36px,5vw,64px); }
.lp-grid{ display:grid; grid-template-columns:1fr; gap:1px; background:var(--lp-line); border:1px solid var(--lp-line); }
@media (min-width:720px){ .lp-grid{ grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (min-width:1080px){ .lp-grid{ grid-template-columns:repeat(3,minmax(0,1fr)); } }
.lp-card{ background:var(--lp-card); padding:clamp(24px,3vw,36px); display:flex; flex-direction:column; gap:12px; transition:background .2s ease; }
.lp-card:hover{ background:var(--lp-bg); }
.lp-card-k{ font-size:11px; font-weight:700; letter-spacing:.14em; color:var(--lp-ink); }
.lp-card h3{ margin:0; font-size:19px; font-weight:700; color:var(--lp-ink); letter-spacing:-.01em; }
.lp-card p{ margin:0; font-size:14px; line-height:1.7; color:var(--lp-muted); }

/* ── 작동 방식 ── */
.lp-how{ background:var(--lp-inverse); color:var(--lp-on-inverse); padding:clamp(70px,9vw,130px) var(--lp-gutter); }
.lp-how .lp-sec-head{ max-width:620px; }
.lp-steps{ list-style:none; margin:0; padding:0; display:grid; grid-template-columns:1fr; gap:clamp(24px,3vw,44px); }
@media (min-width:720px){ .lp-steps{ grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (min-width:1080px){ .lp-steps{ grid-template-columns:repeat(4,minmax(0,1fr)); } }
.lp-steps li{ position:relative; padding-top:22px; border-top:1px solid var(--c-overlay-line-strong,#ffffff2e); }
.lp-step-n{ font-size:12px; font-weight:700; letter-spacing:.16em; color:var(--lp-brand); }
.lp-steps h3{ margin:12px 0 8px; font-size:18px; font-weight:700; color:var(--lp-on-inverse); }
.lp-steps p{ margin:0; font-size:14px; line-height:1.75; color:var(--lp-on-inverse); opacity:.72; }

/* ── CTA · 푸터 ── */
.lp-cta{ background:var(--lp-bg); padding:clamp(70px,9vw,130px) var(--lp-gutter); display:flex; flex-direction:column; align-items:center; gap:26px; text-align:center; }
.lp-h2-center{ align-items:center; }
.lp-h2-center .lp-in2{ padding-left:0; }
.lp-p-center{ margin:0; }
.lp-footer{ background:var(--lp-bg); border-top:1px solid var(--lp-line); padding:26px var(--lp-gutter);
  display:flex; align-items:center; gap:14px; font-size:12px; color:var(--lp-muted); }
.lp-footer-word{ font-size:18px; }

/* ── 궤도 SVG ── */
.lp-orbit{ width:100%; height:auto; display:block; }
.lp-ring{ fill:none; stroke:var(--lp-ink); stroke-width:1; }
.lp-node-coral{ fill:var(--lp-ink); }
.lp-node-peach{ fill:var(--lp-brand); }
.lp-node-mint{ fill:var(--lp-teal); }
.lp-node-mustard{ fill:var(--lp-brand); }
.lp-spin{ transform-origin:310px 310px; }
.lp-spin-a{ animation:lp-rot 34s linear infinite; }
.lp-spin-b{ animation:lp-rot 24s linear infinite reverse; }
.lp-spin-c{ animation:lp-rot 16s linear infinite; }
.lp-core-ring{ fill:none; stroke:rgba(255,255,255,.22); stroke-width:1; }
.lp-pulse{ fill:none; stroke:var(--lp-brand); stroke-width:1; opacity:.5; animation:lp-pulse 3.6s ease-out infinite; transform-origin:310px 310px; }
.lp-core-t1{ fill:#fff; font-size:13px; font-weight:700; letter-spacing:.16em; text-anchor:middle; }
.lp-core-t2{ fill:var(--lp-brand); font-size:13px; letter-spacing:-.02em; text-anchor:middle; }
@keyframes lp-rot{ to{ transform:rotate(360deg); } }
@keyframes lp-pulse{ 0%{ transform:scale(.82); opacity:.55; } 70%{ transform:scale(1.18); opacity:0; } 100%{ opacity:0; } }
@media (prefers-reduced-motion:reduce){ .lp-spin,.lp-pulse{ animation:none; } }

/* ── 모바일 ── */
@media (max-width:700px){
  .lp{ --lp-indent:34px; }
  .lp .lp-nav-links,.lp .lp-nav-cta{ display:none; }
  .lp-burger{ display:flex; }
  .lp-scrim{ display:none; }
  .lp-nav{ order:1; }
  .lp-hero-visual{ order:2; position:relative; top:0; right:0; transform:none; width:114%; margin:10px 0 -8% -7%; opacity:.9; }
  .lp-hero-body{ order:3; }
  .lp-hero{ min-height:auto; }
  .lp-hero-body{ padding:8px 20px 54px 20px; }
  .lp-h1{ font-size:clamp(34px,10vw,56px); }
  .lp-about{ padding-right:0; }
  .lp-about-left .lp-p,.lp-about-left .lp-btn{ margin-left:34px; }
  .lp-in2{ padding-left:34px; }
  .lp-board{ padding:16px 16px 16px 14px; gap:8px; }
  .lp-board-card{ padding:9px 10px; }
  .lp-board-t{ font-size:12px; }
}
`;
