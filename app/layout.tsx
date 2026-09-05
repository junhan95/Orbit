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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${inter.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
