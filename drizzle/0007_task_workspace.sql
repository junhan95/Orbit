-- Asana 식 TASK 확장: 프로젝트 커스텀 필드 정의 + 태스크 필드값 / 하위 작업 / 댓글.
-- drizzle-kit 이 만드는 원본은 색상 기본값 드리프트 때문에 기존 테이블을 재생성하므로
-- 0006 과 같은 방식으로 실제 변경분만 손으로 적었습니다.

ALTER TABLE `tasks` ADD `description` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `project_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'text' NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`show_on_card` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_fields_user_project` ON `project_fields` (`user_id`,`project_id`,`position`);
--> statement-breakpoint
CREATE TABLE `task_field_values` (
	`task_id` text NOT NULL,
	`field_id` text NOT NULL,
	`user_id` text NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `field_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `project_fields`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_field_values_user_field` ON `task_field_values` (`user_id`,`field_id`);
--> statement-breakpoint
CREATE TABLE `subtasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`owner` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_subtasks_user_task` ON `subtasks` (`user_id`,`task_id`,`position`);
--> statement-breakpoint
CREATE TABLE `task_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`author` text NOT NULL,
	`author_kind` text DEFAULT 'user' NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_comments_user_task` ON `task_comments` (`user_id`,`task_id`,`created_at`);
