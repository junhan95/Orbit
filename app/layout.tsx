import type { Metadata } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import './globals.css';

export const dynamic = 'force-dynamic';

// Haas Grotesk 대체 — DESIGN-airtable.md 'Note on Font Substitutes'
const inter = Inter({
  variable: '--font-app-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Orbit — AI Agent Command Center',
  description: 'Claude 에이전트가 협업하고 업무를 나누는 프로젝트 관제 워크스페이스',
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
      <body className={`${inter.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
