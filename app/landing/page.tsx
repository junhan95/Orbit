import type { Metadata } from 'next';
import { LandingView } from './landing-view';

export const metadata: Metadata = {
  title: 'Orbitcrew.ai — 매니저 한 명이 팀 전체를 굴립니다',
  description:
    '프로젝트 매니저 에이전트가 필요한 팀원을 채용하고, 업무를 나누고, 결과를 검토해 보고합니다. 기억·회상·검증이 붙은 AI 에이전트 워크스페이스.',
};

export default function LandingPage() {
  return <LandingView />;
}
