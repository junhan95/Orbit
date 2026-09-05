import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 순수 함수 단위 테스트 설정. D1·Claude API 를 부르는 코드는 다루지 않습니다 (그건 evals 가 맡음).
 * '@/…' 별칭은 tsconfig 의 paths 와 같게 프로젝트 루트로 잡습니다.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)), 'cloudflare:workers': fileURLToPath(new URL('./tests/cloudflare-workers.ts', import.meta.url)) },
  },
});
