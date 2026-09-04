CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`output` text,
	`response_id` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runs_user_task` ON `agent_runs` (`user_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`label` text DEFAULT '신규' NOT NULL,
	`owner` text DEFAULT 'Nori' NOT NULL,
	`status` text DEFAULT '대기' NOT NULL,
	`due` text DEFAULT '일정 미정' NOT NULL,
	`accent` text DEFAULT '#ff7557' NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_user_status` ON `tasks` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_user_created` ON `tasks` (`user_id`,`created_at`);