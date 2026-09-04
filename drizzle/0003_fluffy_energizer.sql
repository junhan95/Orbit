CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`ref_id` text,
	`project_id` text,
	`agent_name` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`web_search_requests` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_usage_user_created` ON `usage_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_user_kind` ON `usage_events` (`user_id`,`kind`);