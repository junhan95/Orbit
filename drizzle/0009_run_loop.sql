-- 4단계 실행 루프: blocked 카드 사유를 업무에 남깁니다 (다음 실행 컨텍스트 + UI 배지).
-- 0006~0008 과 같이 실제 변경분만 손으로 적었습니다.
ALTER TABLE `tasks` ADD `blocked_reason` text;
