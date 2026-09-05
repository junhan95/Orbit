import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 단위·통합 테스트. SQLite와 실제 라우트/세션을 사용하고 외부 공급자 응답만 모사합니다.
 * '@/…' 별칭은 tsconfig 의 paths 와 같게 프로젝트 루트로 잡습니다.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)), 'cloudflare:workers': fileURLToPath(new URL('./tests/cloudflare-workers.ts', import.meta.url)), 'next/headers': fileURLToPath(new URL('./node_modules/vinext/dist/shims/headers.js', import.meta.url)), 'next/server': fileURLToPath(new URL('./node_modules/vinext/dist/shims/server.js', import.meta.url)) },
  },
});
