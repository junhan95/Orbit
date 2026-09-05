-- 검토 에이전트 판정 (플레이북 REVIEW.md). 발견은 댓글로, 판정만 컬럼에.
ALTER TABLE `tasks` ADD `review_verdict` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `reviewed_at` integer;
