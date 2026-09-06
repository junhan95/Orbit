import type { Metadata } from 'next';
import { LandingView } from './landing-view';

export const metadata: Metadata = {
  title: 'orbitcrew.ai — 혼자 하던 일에 AI 팀이 생깁니다',
  description:
    '목표를 알려주면 AI 팀이 조사부터 작성·검토까지. 300 크레딧으로 무료 체험하고, 본인 Anthropic API 키 연결 시 서비스 이용료 없이 시작하세요. AI 사용료 별도.',
};

export default function LandingPage() {
  return <LandingView />;
}
