import type { Metadata } from 'next';
import { LandingView } from './landing-view';

export const metadata: Metadata = {
  title: 'orbitcrew.ai — One manager runs your whole team',
  description:
    'A project-manager agent hires the teammates it needs, splits the work, reviews the results, and reports back. An AI agent workspace with memory, recall, and verification. 매니저 한 명이 팀 전체를 굴립니다.',
};

export default function LandingPage() {
  return <LandingView />;
}
