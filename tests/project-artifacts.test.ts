import { afterEach, expect, it, vi } from 'vitest';
import { forgetFolderArtifacts, isBrowserViewable, mimeOf, readArtifacts, recordArtifact } from '../lib/project-artifacts';
afterEach(() => vi.unstubAllGlobals());

function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  vi.stubGlobal('window', { dispatchEvent: () => true });
  vi.stubGlobal('Event', class { constructor(public type: string) {} });
  return data;
}

it('records saved files per project, newest first, de-duplicated by folder and path', () => {
  stubStorage();
  expect(readArtifacts('p1')).toEqual([]);
  recordArtifact('p1', 'f1', 'index.html', 100);
  recordArtifact('p1', 'f1', 'README.md', 200);
  recordArtifact('p1', 'f1', 'Index.HTML', 300); // 같은 파일 재저장 → 하나로 합쳐 최신이 앞
  expect(readArtifacts('p1').map(item => [item.path, item.savedAt])).toEqual([['Index.HTML', 300], ['README.md', 200]]);
  expect(readArtifacts('p2')).toEqual([]);
});

it('drops a folder\'s artifacts when the folder is unlinked and ignores corrupt storage', () => {
  const data = stubStorage();
  recordArtifact('p1', 'f1', 'a.html', 1);
  recordArtifact('p1', 'f2', 'b.md', 2);
  forgetFolderArtifacts('p1', 'f1');
  expect(readArtifacts('p1').map(item => item.path)).toEqual(['b.md']);
  data.set('orbit.project-artifacts.p1', '{"not":"an array"}');
  expect(readArtifacts('p1')).toEqual([]);
});

it('opens html, images and pdf in the browser and previews the rest as text', () => {
  expect(isBrowserViewable('index.html')).toBe(true);
  expect(isBrowserViewable('docs/report.PDF')).toBe(true);
  expect(isBrowserViewable('research.md')).toBe(false);
  expect(mimeOf('index.html')).toBe('text/html');
  expect(mimeOf('notes.unknown')).toBe('text/plain');
});
