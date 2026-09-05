import type { Metadata } from 'next';
import { Figtree, Geist_Mono } from 'next/font/google';
import './globals.css';

export const dynamic = 'force-dynamic';

// Roobert PRO 대체 — DESIGN-miro.md. Roobert 는 유료라, 성격이 가장 가까운
// 무료 기하학적 산세리프(Figtree)를 씁니다. 한글은 --font-app 의 폴백이 받습니다.
const figtree = Figtree({
  variable: '--font-app-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Orbit — AI Agent Command Center',
  description: 'Claude 에이전트가 협업하고 업무를 나누는 프로젝트 관제 워크스페이스',
  icons: {
    // SVG 가 우선(다크 탭에서 색이 바뀜), ICO 는 구형 브라우저 폴백
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico', sizes: '48x48' }],
    apple: '/apple-touch-icon.png',
  },
};

/**
 * 첫 페인트 전에 저장된 테마를 <html> 에 붙입니다.
 * 이게 없으면 다크 사용자에게 흰 화면이 한 번 번쩍입니다.
 */
const THEME_BOOTSTRAP = `(()=>{try{
  var p=JSON.parse(localStorage.getItem('orbit-preferences')||'{}');
  var choice=p.theme==='dark'||p.theme==='light'?p.theme:'system';
  var dark=choice==='dark'||(choice==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
  var el=document.documentElement;
  el.classList.toggle('dark',dark);
  el.dataset.theme=choice;
  if(p.lang==='en')el.lang='en';
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className={`${figtree.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
