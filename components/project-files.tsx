'use client';
/**
 * 프로젝트 상세 머리의 '결과보기' · '폴더열기'.
 * - 결과보기: 에이전트가 이 브라우저에서 저장한 최신 산출물(lib/project-artifacts)을 새 탭에서 바로 실행합니다 — 목록 창 없이 결과 화면이 뜹니다.
 *   HTML·이미지·PDF 가 아니면(예: research.md) 텍스트 미리보기 창으로 보여 줍니다.
 * - 폴더열기: 프로젝트를 만들 때 브라우저에 허용한 작업 폴더를 그 권한 그대로 엽니다 (LocalFileWorkspace — 파일 목록·열기·편집·저장).
 */
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LocalFileWorkspace } from '@/components/local-file-workspace';
import { ensureReadPermission, fetchProjectFolders, getHandle, type FsDirHandle } from '@/lib/folder-access';
import { fileSegments, readLocalFile } from '@/lib/local-files';
import { isBrowserViewable, mimeOf, readArtifacts, subscribeArtifacts, type ProjectArtifact } from '@/lib/project-artifacts';
import { t } from '@/lib/i18n';

export function useProjectArtifacts(projectId: string): ProjectArtifact[] {
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  useEffect(() => {
    const refresh = () => setArtifacts(readArtifacts(projectId));
    refresh();
    return subscribeArtifacts(refresh);
  }, [projectId]);
  return artifacts;
}

async function folderHandle(folderId: string): Promise<FsDirHandle> {
  const handle = await getHandle(folderId);
  if (!handle || !await ensureReadPermission(handle)) throw new Error(t('프로젝트의 작업 폴더에서 이 폴더를 다시 연결해 주세요.'));
  return handle;
}

/** 바이너리까지 그대로 읽습니다 (이미지·PDF 를 새 탭에 띄울 때). */
async function readFile(root: FsDirHandle, path: string): Promise<File> {
  const parts = fileSegments(path);
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
}

/** 산출물을 새 탭에서 엽니다. 팝업 차단을 피하려고 클릭 동기 구간에서 창을 먼저 열고, 파일을 읽은 뒤 주소를 바꿉니다. */
async function openInNewTab(folderId: string, path: string) {
  const tab = window.open('', '_blank');
  try {
    const file = await readFile(await folderHandle(folderId), path);
    const url = URL.createObjectURL(new Blob([await file.arrayBuffer()], { type: mimeOf(path) }));
    if (tab) tab.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) { tab?.close(); throw error; }
}

type Preview = { path: string; text: string };

export function ProjectFileButtons({ projectId, onNotice }: { projectId: string; onNotice: (message: string) => void }) {
  const artifacts = useProjectArtifacts(projectId);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const fail = useCallback((error: unknown, fallback: string) => {
    onNotice(error instanceof Error ? t(error.message) : fallback);
  }, [onNotice]);

  /** 결과보기 — 가장 최근 산출물을 바로 띄웁니다. */
  async function showResult() {
    if (busy) return;
    setBusy(true);
    try {
      const linked = await fetchProjectFolders(projectId);
      const latest = artifacts.find(item => linked.some(folder => folder.id === item.folderId));
      if (!latest) { onNotice(t('저장된 산출물이 아직 없습니다.')); return; }
      if (isBrowserViewable(latest.path)) { await openInNewTab(latest.folderId, latest.path); return; }
      const text = await readLocalFile(await folderHandle(latest.folderId), latest.path);
      setPreview({ path: latest.path, text });
    } catch (error) { fail(error, t('파일을 열지 못했습니다.')); }
    finally { setBusy(false); }
  }

  return <div className="detail-file-actions">
    <Button variant="outline" disabled={!artifacts.length || busy} onClick={() => void showResult()}
      title={artifacts.length ? undefined : t('에이전트가 작업을 완료하고 파일을 저장하면 열 수 있습니다.')}>
      {busy ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} {t('결과보기')}{artifacts.length > 0 && <em className="detail-file-count">{artifacts.length}</em>}
    </Button>
    <LocalFileWorkspace projectId={projectId} label={t('폴더열기')} className="detail-file-trigger" autoSelectFolder />
    <Dialog open={preview !== null} onOpenChange={(value) => { if (!value) setPreview(null); }}>
      <DialogContent className="project-files-dialog">
        {preview && <>
          <DialogHeader><DialogTitle>{preview.path}</DialogTitle><DialogDescription>{t('브라우저에서 바로 실행할 수 없는 형식이라 내용을 보여 줍니다.')}</DialogDescription></DialogHeader>
          <div className="project-files-preview"><pre>{preview.text}</pre></div>
        </>}
      </DialogContent>
    </Dialog>
  </div>;
}
