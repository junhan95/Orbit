'use client';
/**
 * 프로젝트 상세 머리의 '결과보기' · '폴더열기'.
 * - 결과보기: 에이전트가 이 브라우저에서 저장한 산출물(lib/project-artifacts)이 있을 때만 켜집니다.
 * - 폴더열기: 연결한 작업 폴더의 파일 목록을 항상 엽니다 (브라우저는 탐색기를 띄울 수 없으므로 앱 안에서 봅니다).
 * HTML·이미지·PDF 는 새 탭에 렌더링하고, 나머지 텍스트는 대화상자 안에서 보여 줍니다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, FolderOpen, LoaderCircle, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ensureReadPermission, fetchProjectFolders, getHandle, scanDirectory, type FsDirHandle, type ProjectFolder } from '@/lib/folder-access';
import { fileSegments, readLocalFile } from '@/lib/local-files';
import { isBrowserViewable, mimeOf, readArtifacts, subscribeArtifacts, type ProjectArtifact } from '@/lib/project-artifacts';
import { t, tf } from '@/lib/i18n';

type Mode = 'results' | 'folder';
type Entry = { folderId: string; folderName: string; path: string; savedAt?: number };

export function useProjectArtifacts(projectId: string): ProjectArtifact[] {
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  useEffect(() => {
    const refresh = () => setArtifacts(readArtifacts(projectId));
    refresh();
    return subscribeArtifacts(refresh);
  }, [projectId]);
  return artifacts;
}

/** 바이너리까지 그대로 읽습니다 (이미지·PDF 를 새 탭에 띄울 때). */
async function readFile(root: FsDirHandle, path: string): Promise<File> {
  const parts = fileSegments(path);
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ProjectFileButtons({ projectId, onNotice }: { projectId: string; onNotice: (message: string) => void }) {
  const artifacts = useProjectArtifacts(projectId);
  const [mode, setMode] = useState<Mode | null>(null);
  return <div className="detail-file-actions">
    <Button variant="outline" disabled={!artifacts.length} onClick={() => setMode('results')}
      title={artifacts.length ? undefined : t('에이전트가 작업을 완료하고 파일을 저장하면 열 수 있습니다.')}>
      <Sparkles size={14} /> {t('결과보기')}{artifacts.length > 0 && <em className="detail-file-count">{artifacts.length}</em>}
    </Button>
    <Button variant="outline" onClick={() => setMode('folder')}><FolderOpen size={14} /> {t('폴더열기')}</Button>
    <ProjectFilesDialog projectId={projectId} mode={mode} artifacts={artifacts} onClose={() => setMode(null)} onNotice={onNotice} />
  </div>;
}

function ProjectFilesDialog({ projectId, mode, artifacts, onClose, onNotice }: {
  projectId: string; mode: Mode | null; artifacts: ProjectArtifact[]; onClose: () => void; onNotice: (message: string) => void;
}) {
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(null);
  const handles = useRef(new Map<string, FsDirHandle>());

  const handleFor = useCallback(async (folderId: string): Promise<FsDirHandle> => {
    const cached = handles.current.get(folderId);
    if (cached) return cached;
    const handle = await getHandle(folderId);
    if (!handle || !await ensureReadPermission(handle)) throw new Error(t('프로젝트의 작업 폴더에서 이 폴더를 다시 연결해 주세요.'));
    handles.current.set(folderId, handle);
    return handle;
  }, []);

  useEffect(() => {
    if (!mode) return;
    let alive = true;
    (async () => {
      setLoading(true); setNote(''); setPreview(null); setEntries([]);
      const linked = await fetchProjectFolders(projectId);
      if (!alive) return;
      setFolders(linked);
      const list: Entry[] = [];
      const problems: string[] = [];
      if (mode === 'results') {
        for (const item of artifacts) {
          const folder = linked.find(candidate => candidate.id === item.folderId);
          if (folder) list.push({ folderId: folder.id, folderName: folder.name, path: item.path, savedAt: item.savedAt });
        }
      } else {
        for (const folder of linked) {
          try {
            const handle = await handleFor(folder.id);
            const { files, truncated } = await scanDirectory(handle);
            for (const file of files) if (file.readable) list.push({ folderId: folder.id, folderName: folder.name, path: file.path });
            if (truncated) problems.push(tf("'{0}' 폴더는 파일이 많아 일부만 표시합니다.", folder.name));
          } catch (error) { problems.push(`${folder.name}: ${error instanceof Error ? error.message : t('폴더를 열지 못했습니다.')}`); }
        }
      }
      if (!alive) return;
      setEntries(list); setNote(problems.join(' '));
    })().catch((error: unknown) => { if (alive) setNote(error instanceof Error ? error.message : t('폴더를 열지 못했습니다.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [mode, projectId, artifacts, handleFor]);

  async function openEntry(entry: Entry) {
    setNote('');
    if (isBrowserViewable(entry.path)) {
      // 팝업 차단을 피하려고 클릭 동기 구간에서 창을 먼저 열고, 파일을 읽은 뒤 주소를 바꿉니다.
      const tab = window.open('', '_blank');
      try {
        const file = await readFile(await handleFor(entry.folderId), entry.path);
        const url = URL.createObjectURL(new Blob([await file.arrayBuffer()], { type: mimeOf(entry.path) }));
        if (tab) tab.location.href = url; else window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (error) {
        tab?.close();
        const message = error instanceof Error ? error.message : t('파일을 열지 못했습니다.');
        setNote(message); onNotice(message);
      }
      return;
    }
    try {
      const text = await readLocalFile(await handleFor(entry.folderId), entry.path);
      setPreview({ path: entry.path, text });
    } catch (error) { setNote(error instanceof Error ? error.message : t('파일을 열지 못했습니다.')); }
  }

  const title = mode === 'results' ? t('에이전트 산출물') : t('작업 폴더 파일');
  const description = mode === 'results'
    ? t('에이전트가 이 브라우저에서 저장한 파일입니다. HTML·이미지·PDF 는 새 탭에서 열리고, 나머지는 여기서 내용을 보여 줍니다.')
    : t('연결한 작업 폴더의 파일입니다. 브라우저는 탐색기를 직접 열 수 없어 앱 안에서 보여 줍니다.');

  return <Dialog open={mode !== null} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent className="project-files-dialog">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {loading
        ? <div className="view-loading"><LoaderCircle className="spin" /><span>{t('폴더를 읽는 중')}</span></div>
        : !folders.length
          ? <p className="project-files-empty">{t('아직 연결한 작업 폴더가 없습니다. 아래 작업 폴더 섹션의 폴더 추가로 먼저 연결해 주세요.')}</p>
          : !entries.length
            ? <p className="project-files-empty">{mode === 'results' ? t('저장된 산출물이 아직 없습니다.') : t('표시할 파일이 없습니다.')}</p>
            : <ul className="project-files-list">
              {entries.map((entry) => <li key={`${entry.folderId}/${entry.path}`}>
                <button onClick={() => void openEntry(entry)}>
                  {isBrowserViewable(entry.path) ? <ExternalLink size={14} /> : <FileText size={14} />}
                  <span><b>{entry.path}</b><small>{entry.folderName}{entry.savedAt ? ` · ${formatTime(entry.savedAt)}` : ''}</small></span>
                </button>
              </li>)}
            </ul>}
      {preview && <div className="project-files-preview">
        <div><b>{preview.path}</b><button onClick={() => setPreview(null)}>{t('폴더 파일 미리보기 닫기')}</button></div>
        <pre>{preview.text}</pre>
      </div>}
      {note && <output className="local-file-error">{note}</output>}
    </DialogContent>
  </Dialog>;
}
