-- 마감일(due) 을 걷어내고 중요도(priority) 로 우선순위를 정합니다.
-- '높음' | '중간' | '낮음' — 기존 카드는 모두 '중간' 으로 시작합니다.
ALTER TABLE `tasks` ADD `priority` text DEFAULT '중간' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_tasks_user_due`;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `due`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tasks_user_priority` ON `tasks` (`user_id`,`priority`);
