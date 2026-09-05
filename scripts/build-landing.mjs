/**
 * 랜딩페이지(/landing)를 정적 HTML 로 굽습니다 — GitHub Pages 배포용.
 *
 *   node scripts/build-landing.mjs            → dist-landing/index.html, 404.html, .nojekyll
 *   LANDING_APP_URL=https://app.example.com   → CTA 의 /login 을 이 주소로 바꿉니다 (없으면 상대 경로 유지)
 *   LANDING_REDIRECT=https://orbitcrew.ai    → 랜딩 대신 이 주소로 보내는 리디렉션 페이지만 만듭니다
 *
 * 방법: Vite 를 미들웨어 모드로 띄워 app/landing/landing-view.tsx 를 그대로 불러온 뒤
 * react-dom/server 로 렌더합니다. 컴포넌트를 복제하지 않으므로 앱과 랜딩이 갈라지지 않습니다.
 * 색 토큰은 app/globals.css 의 :root / .dark 블록을 그대로 잘라 넣습니다.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const OUT = 'dist-landing';
const APP_URL = (process.env.LANDING_APP_URL || '').replace(/\/$/, '');
/** 약관·방침 페이지는 Worker 가 내므로 정적 빌드에서는 서비스 도메인의 절대 주소로 바꿉니다. */
const SITE_URL = (process.env.LANDING_SITE_URL || 'https://orbitcrew.ai').replace(/\/$/, '');

/**
 * LANDING_REDIRECT=https://orbitcrew.ai 가 있으면 랜딩을 굽지 않고, 그 주소로 보내는 리디렉션 페이지만 만듭니다.
 * 랜딩이 서비스 도메인(Worker)으로 옮겨간 뒤 GitHub Pages 주소로 들어오는 방문자를 넘기기 위한 용도입니다.
 */
const REDIRECT = (process.env.LANDING_REDIRECT || '').replace(/\/$/, '');
if (REDIRECT) {
  const target = `${REDIRECT}/`;
  const page = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${target}">
<link rel="canonical" href="${target}">
<title>Orbitcrew.ai — ${target}</title>
<script>location.replace(${JSON.stringify(target)} + location.hash);</script>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.6 system-ui,sans-serif;color:#1c1c1e;background:#fff}a{color:#4262ff}</style>
</head>
<body><p>Orbitcrew 는 <a href="${target}">${target}</a> 로 이사했습니다.</p></body>
</html>
`;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'index.html'), page);
  writeFileSync(resolve(OUT, '404.html'), page);
  writeFileSync(resolve(OUT, '.nojekyll'), '');
  console.log(`리디렉션 페이지 생성 → ${OUT}/index.html, 404.html (→ ${target})`);
  process.exit(0);
}

function cssBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`globals.css 에서 '${selector} {' 블록을 찾지 못했습니다.`);
  const end = css.indexOf('\n}\n', start);
  return css.slice(start, end + 3);
}

const globals = readFileSync('app/globals.css', 'utf8');
const tokens = cssBlock(globals, ':root') + cssBlock(globals, '.dark');

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  plugins: [react()],
  resolve: { alias: { '@': resolve(process.cwd()) } },
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
});

let body;
try {
  const mod = await server.ssrLoadModule('/app/landing/landing-view.tsx');
  body = renderToStaticMarkup(createElement(mod.LandingView));
} finally {
  await server.close();
}

if (APP_URL) body = body.replaceAll('href="/login"', `href="${APP_URL}/login"`);
for (const path of ['/privacy', '/terms']) body = body.replaceAll(`href="${path}"`, `href="${SITE_URL}${path}"`);

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orbitcrew.ai — 매니저 한 명이 팀 전체를 굴립니다</title>
<meta name="description" content="프로젝트 매니저 에이전트가 필요한 팀원을 채용하고, 업무를 나누고, 결과를 검토해 보고합니다. 기억·회상·검증이 붙은 AI 에이전트 워크스페이스.">
<meta property="og:title" content="Orbitcrew.ai — AI Agent Command Center">
<meta property="og:description" content="매니저 한 명이 팀 전체를 굴립니다.">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" href="favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
<style>
${tokens}
/* next/font 가 없으므로 본문 폰트 변수를 직접 채웁니다 */
:root{--font-app-sans:'Figtree'}
html,body{margin:0;background:var(--c-app-bg);color:var(--c-ink)}
</style>
<script>(function(){try{if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}})()</script>
</head>
<body>
${body}
<script>
(function(){
  var b=document.querySelector('.lp-burger'),m=document.getElementById('lp-mobile-menu');
  if(!b||!m)return;
  b.addEventListener('click',function(){var open=m.hidden;m.hidden=!open;b.setAttribute('aria-expanded',String(open));});
  m.addEventListener('click',function(e){if(e.target.tagName==='A'){m.hidden=true;b.setAttribute('aria-expanded','false');}});
})();
</script>
</body>
</html>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/index.html`, html);
writeFileSync(`${OUT}/404.html`, html);
writeFileSync(`${OUT}/.nojekyll`, '');
for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) copyFileSync(`public/${f}`, `${OUT}/${f}`);
console.log(`랜딩 정적 빌드 완료 → ${OUT}/index.html (${(html.length / 1024).toFixed(1)} KB)${APP_URL ? `, 앱 주소 ${APP_URL}` : ', 앱 링크는 상대 경로(/login) 그대로'}`);
