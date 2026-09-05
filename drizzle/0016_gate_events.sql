-- 게이트 결정 로그 + 관제 밴드 검사 기록 (lib/gates.ts, lib/health.ts).
CREATE TABLE `gate_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`gate` text NOT NULL,
	`decision` text NOT NULL,
	`project_id` text,
	`task_id` text,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_gate_events_user_gate` ON `gate_events` (`user_id`,`gate`,`created_at`);
