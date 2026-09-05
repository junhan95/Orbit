-- 5단계 대화 압축: 대화(프로젝트×에이전트)당 누적 요약 1행.
CREATE TABLE `chat_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`content` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`covers_from` integer NOT NULL,
	`covers_to` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chat_summaries_conversation` ON `chat_summaries` (`user_id`,`project_id`,`agent_id`);
