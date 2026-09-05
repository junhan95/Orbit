CREATE TABLE `recall_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_key` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`project_id` text,
	`agent_name` text,
	`role` text,
	`title` text,
	`content` text NOT NULL,
	`content_bigram` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`compacted` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recall_docs_doc_key_unique` ON `recall_docs` (`doc_key`);--> statement-breakpoint
CREATE INDEX `idx_recall_user_kind_created` ON `recall_docs` (`user_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_recall_user_project` ON `recall_docs` (`user_id`,`project_id`);--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `outcome` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `metadata` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `summary` text;