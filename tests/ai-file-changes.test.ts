import { expect, it } from 'vitest';
import { validateFileChange } from '../lib/ai-file-changes';
it('accepts explicit file proposals only for the selected session folders', () => {
  const change = { folderId: 'linked', path: 'src/app.js', content: 'console.log(1)' };
  expect(validateFileChange(change, ['linked'])).toEqual(change);
  expect(() => validateFileChange(change, ['other'])).toThrow();
  expect(() => validateFileChange(change, [])).toThrow();
});
it('rejects malformed, oversized, and escaped file proposals', () => {
  for (const raw of [null, {}, { folderId: 'f', path: 'a.txt', content: 3 }, { folderId: 'f', path: '../a', content: 'x' }, { folderId: 'f', path: 'C:/a', content: 'x' }, { folderId: 'f', path: '.env', content: 'x' }, { folderId: 'f', path: 'a.txt', content: 'x'.repeat(200001) }]) expect(() => validateFileChange(raw, ['f'])).toThrow();
});
