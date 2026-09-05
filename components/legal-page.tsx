import type { ReactNode } from 'react';
import { OrbitMark } from '@/components/orbit-mark';
import { COMPANY, LEGAL_EFFECTIVE, LEGAL_LINKS } from '@/lib/legal';

/**
 * 개인정보처리방침·이용약관 공용 레이아웃.
 *
 * 랜딩과 같은 --c-* 토큰을 쓰되, 정적 미리보기처럼 토큰이 없는 환경에서도 읽히도록 폴백을 둡니다.
 * 스타일은 .legal 스코프 안에만 있어 globals.css 를 건드리지 않습니다.
 * 서버 컴포넌트 — 클라이언트 JS 가 필요 없습니다.
 */
export function LegalPage({
  title,
  titleEn,
  intro,
  children,
}: {
  title: string;
  titleEn: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="legal">
      <style>{LEGAL_CSS}</style>
      <header className="legal-top">
        {/* oxlint-disable-next-line next/no-html-link-for-pages -- 랜딩 호스트의 루트로 가는 절대 링크 */}
        <a className="legal-brand" href={COMPANY.site}>
          <OrbitMark size={22} />
          <span className="legal-word">orbitcrew</span>
        </a>
        <nav className="legal-nav">
          {LEGAL_LINKS.map((link) => (
            // oxlint-disable-next-line next/no-html-link-for-pages -- 같은 호스트의 고정 경로
            <a href={link.href} key={link.href}>{link.label}</a>
          ))}
        </nav>
      </header>

      <main className="legal-main">
        <p className="legal-kicker">{titleEn}</p>
        <h1 className="legal-h1">{title}</h1>
        <p className="legal-meta">시행일 {LEGAL_EFFECTIVE} · Effective {LEGAL_EFFECTIVE}</p>
        <div className="legal-intro">{intro}</div>
        {children}
      </main>

      <footer className="legal-foot">
        <p>
          {COMPANY.name} · 대표 {COMPANY.ceo} · 사업자등록번호 {COMPANY.registration} · {COMPANY.address}
        </p>
        <p>
          문의 <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
        </p>
      </footer>
    </div>
  );
}

/** 한 조항. 한글 본문 + (선택) 영문 요약. */
export function Clause({ n, title, titleEn, children, en }: { n: string; title: string; titleEn?: string; children: ReactNode; en?: ReactNode }) {
  return (
    <section className="legal-clause" id={`c${n}`}>
      <h2 className="legal-h2">
        <span className="legal-n">{n}</span>
        {title}
        {titleEn ? <span className="legal-h2-en">{titleEn}</span> : null}
      </h2>
      <div className="legal-body">{children}</div>
      {en ? <div className="legal-en"><span className="legal-en-tag">EN</span>{en}</div> : null}
    </section>
  );
}

const LEGAL_CSS = `
.legal{ --lg-bg:var(--c-app-bg,#fff); --lg-ink:var(--c-ink,#1c1c1e); --lg-text:var(--c-text,#2c2c34); --lg-muted:var(--c-text-muted,#555a6a);
  --lg-line:var(--c-line,#e0e2e8); --lg-soft:var(--c-surface-soft,#f7f8fa); --lg-link:var(--c-link,#4262ff);
  background:var(--lg-bg); color:var(--lg-text); min-height:100vh;
  font-family:var(--font-app,var(--font-app-sans),'Figtree','Pretendard','Noto Sans KR',system-ui,sans-serif); line-height:1.7; }
.legal a{ color:var(--lg-link); text-decoration:none; }
.legal a:hover{ text-decoration:underline; }
.legal-top{ display:flex; align-items:center; justify-content:space-between; gap:16px; padding:18px clamp(20px,5vw,64px);
  border-bottom:1px solid var(--lg-line); }
.legal-brand{ display:inline-flex; align-items:center; gap:8px; color:var(--lg-ink) !important; }
.legal-word{ font-weight:700; letter-spacing:-0.02em; font-size:18px; }
.legal-nav{ display:flex; gap:18px; font-size:13px; }
.legal-nav a{ color:var(--lg-muted); }
.legal-main{ max-width:760px; margin:0 auto; padding:48px clamp(20px,5vw,64px) 72px; }
.legal-kicker{ margin:0 0 6px; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:var(--lg-muted); }
.legal-h1{ margin:0; color:var(--lg-ink); font-size:clamp(28px,4vw,40px); letter-spacing:-0.03em; line-height:1.15; }
.legal-meta{ margin:10px 0 0; font-size:13px; color:var(--lg-muted); }
.legal-intro{ margin:28px 0 8px; padding:18px 20px; background:var(--lg-soft); border-radius:16px; font-size:15px; }
.legal-intro p{ margin:0 0 8px; } .legal-intro p:last-child{ margin:0; }
.legal-clause{ padding:26px 0; border-bottom:1px solid var(--lg-line); }
.legal-clause:last-child{ border-bottom:0; }
.legal-h2{ display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin:0 0 12px; color:var(--lg-ink); font-size:19px; letter-spacing:-0.02em; }
.legal-n{ font-size:12px; color:var(--lg-muted); font-variant-numeric:tabular-nums; min-width:24px; }
.legal-h2-en{ font-size:13px; font-weight:500; color:var(--lg-muted); }
.legal-body{ font-size:15px; }
.legal-body p{ margin:0 0 10px; }
.legal-body ul, .legal-body ol{ margin:6px 0 12px; padding-left:22px; }
.legal-body li{ margin:4px 0; }
.legal-body table{ width:100%; border-collapse:collapse; font-size:13.5px; margin:8px 0 12px; }
.legal-body th, .legal-body td{ text-align:left; vertical-align:top; padding:8px 10px; border:1px solid var(--lg-line); }
.legal-body th{ background:var(--lg-soft); font-weight:600; white-space:nowrap; }
.legal-body .legal-tablewrap{ overflow-x:auto; }
.legal-en{ position:relative; margin-top:14px; padding:12px 14px 12px 44px; border-left:2px solid var(--lg-line); font-size:13.5px; color:var(--lg-muted); }
.legal-en p{ margin:0 0 6px; } .legal-en p:last-child{ margin:0; }
.legal-en-tag{ position:absolute; left:14px; top:13px; font-size:10px; font-weight:700; letter-spacing:0.08em; color:var(--lg-muted); }
.legal-foot{ border-top:1px solid var(--lg-line); padding:22px clamp(20px,5vw,64px); font-size:12px; color:var(--lg-muted); }
.legal-foot p{ margin:0 0 4px; }
@media (max-width:640px){ .legal-nav{ display:none; } }
`;
