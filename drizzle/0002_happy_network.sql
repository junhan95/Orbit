PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`project_id` text,
	`label` text DEFAULT '신규' NOT NULL,
	`owner` text DEFAULT 'Nori' NOT NULL,
	`status` text DEFAULT '대기' NOT NULL,
	`due` integer,
	`accent` text DEFAULT '#ff7557' NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "user_id", "title", "project_id", "label", "owner", "status", "due", "accent", "result", "created_at", "updated_at") SELECT "id", "user_id", "title", "project_id", "label", "owner", "status", "due", "accent", "result", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_tasks_user_status` ON `tasks` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_user_created` ON `tasks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_tasks_user_due` ON `tasks` (`user_id`,`due`);--> statement-breakpoint
CREATE TABLE `__new_project_agents` (
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text NOT NULL,
	`assigned_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `agent_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_project_agents`("project_id", "agent_id", "user_id", "assigned_at") SELECT "project_id", "agent_id", "user_id", "assigned_at" FROM `project_agents`;--> statement-breakpoint
DROP TABLE `project_agents`;--> statement-breakpoint
ALTER TABLE `__new_project_agents` RENAME TO `project_agents`;--> statement-breakpoint
CREATE INDEX `idx_project_agents_user_project` ON `project_agents` (`user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_runs_user_started` ON `agent_runs` (`user_id`,`started_at`);