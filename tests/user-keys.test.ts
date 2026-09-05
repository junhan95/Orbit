import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, keyHint, looksLikeAnthropicKey } from '@/lib/user-keys-crypto';

const SECRET = 'test-master-secret-with-enough-length-0123456789';

describe('사용자 API 키 암호화 (BYOK)', () => {
  it('암호화 → 복호화 왕복', async () => {
    const plain = 'sk-ant-api03-' + 'x'.repeat(40);
    const { ciphertext, iv } = await encryptSecret(SECRET, plain);
    expect(ciphertext).not.toContain('sk-ant');
    expect(iv).toHaveLength(16); // 12바이트 base64url
    expect(await decryptSecret(SECRET, ciphertext, iv)).toBe(plain);
  });

  it('같은 평문도 매번 다른 암호문 (iv 난수)', async () => {
    const a = await encryptSecret(SECRET, 'sk-ant-same');
    const b = await encryptSecret(SECRET, 'sk-ant-same');
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('다른 시크릿으로는 복호화 실패', async () => {
    const { ciphertext, iv } = await encryptSecret(SECRET, 'sk-ant-api03-abc');
    await expect(decryptSecret(SECRET + '!', ciphertext, iv)).rejects.toThrow();
  });

  it('짧은 시크릿 거부', async () => {
    await expect(encryptSecret('short', 'x')).rejects.toThrow();
  });

  it('키 모양 검사와 힌트', () => {
    expect(looksLikeAnthropicKey('sk-ant-api03-' + 'a'.repeat(30))).toBe(true);
    expect(looksLikeAnthropicKey('sk-proj-abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(looksLikeAnthropicKey('sk-ant-short')).toBe(false);
    expect(keyHint('sk-ant-api03-abcdefgh1234')).toBe('sk-ant-…1234');
  });
});
