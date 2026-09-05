-- 6단계 절차적 기억: 스킬.
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text DEFAULT 'project' NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`created_by` text NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_skills_user_scope` ON `skills` (`user_id`,`scope`,`project_id`);
