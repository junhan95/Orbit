import type { Metadata } from 'next';
import { LoginView } from './login-view';

export const metadata: Metadata = {
  title: 'Orbit — 로그인',
  description: 'Google 또는 GitHub 계정으로 Orbit 에 들어갑니다.',
};

export default function LoginPage() {
  return <LoginView />;
}
