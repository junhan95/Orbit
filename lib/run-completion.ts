/** A stopped model is not proof that the task finished. A real completion report takes precedence. */
export function completionState(report: { status: 'completed' | 'blocked'; blockedReason: string | null } | null, stopReason: string | null) {
  if (report?.status === 'completed') return { blocked: false, blockedReason: null };
  if (report?.status === 'blocked') return { blocked: true, blockedReason: report.blockedReason || '에이전트가 업무를 진행할 수 없다고 보고했습니다.' };
  const reasons: Record<string, string> = {
    insufficient_credits: '크레딧 부족으로 완료 보고 전에 중단했습니다.',
    max_iterations: '도구 호출 상한에 도달하여 완료 보고 전에 중단했습니다.',
    max_tokens: '출력 토큰 한도에 도달하여 완료 보고 전에 중단했습니다.',
  };
  return { blocked: true, blockedReason: reasons[stopReason ?? ''] || '완료 보고를 받지 못했습니다. 결과를 확인한 뒤 다시 실행하세요.' };
}
