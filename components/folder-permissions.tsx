'use client';
import { useSyncExternalStore } from 'react';
import { ShieldCheck, ChevronDown, Check } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { folderApproval, setFolderApproval, subscribeFolderApproval, serverFolderApproval, type FolderApproval } from '@/lib/folder-permissions';
import { t } from '@/lib/i18n';
export function FolderPermissions({ onNotice }: { onNotice: (message: string) => void }) {
  const mode = useSyncExternalStore(subscribeFolderApproval, folderApproval, serverFolderApproval);
  function change(next: FolderApproval) {
    try {
      setFolderApproval(next);
      onNotice(t('AI 파일 변경 승인 방식을 저장했습니다.'));
    } catch { onNotice(t('승인 방식을 저장하지 못했습니다.')); }
  }
  return <DropdownMenu>
    <DropdownMenuTrigger render={<button className="composer-tool" type="button" aria-label={`${t('폴더 접근 권한')}: ${t(mode === 'ask' ? '변경 전 승인 요청' : '자동 진행')}`} title={t('폴더 접근 권한')} />}><ShieldCheck size={13} /> {t(mode === 'ask' ? '변경 전 승인 요청' : '자동 진행')} <ChevronDown size={12} /></DropdownMenuTrigger>
    <DropdownMenuContent className="autonomy-menu folder-access-menu" align="start">
      <p>{t('AI가 파일을 변경할 때의 승인 방식을 선택하세요.')}</p>
      {(['ask', 'auto'] as const).map(option => <DropdownMenuItem key={option} onClick={() => change(option)}>
        <span className="autonomy-check">{mode === option && <Check size={13} />}</span>
        <span><b>{t(option === 'ask' ? '변경 전 승인 요청' : '자동 진행')}</b><small>{t(option === 'ask' ? 'AI가 파일을 생성·수정하기 전에 변경 내용을 확인하고 승인합니다.' : 'AI가 파일을 생성·수정할 때 매번 묻지 않고 진행하도록 설정합니다.')}</small></span>
      </DropdownMenuItem>)}
      <p>{t('자동 진행은 새 AI 답변의 파일 변경에 적용됩니다. 브라우저의 최초 쓰기 권한 허용은 필요합니다.')}</p>
    </DropdownMenuContent>
  </DropdownMenu>;
}
