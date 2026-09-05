-- 승인 대기 큐 (물어보기형 게이트, lib/approvals.ts).
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`project_id` text,
	`task_id` text,
	`run_id` text,
	`summary` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_approvals_user_status` ON `approvals` (`user_id`,`status`,`created_at`);
