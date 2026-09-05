-- 에이전트를 프로젝트에 귀속시킵니다.
--   project_id : NULL 이면 어느 프로젝트에도 속하지 않은 공용 에이전트
--   is_manager : 1 이면 그 프로젝트의 전담 프로젝트 매니저 (프로젝트당 1명)
--   role_key   : lib/agent-catalog.ts 의 직무 키. 매니저가 같은 직무를 중복 채용하지 않게 하는 기준.
-- SQLite 는 ADD COLUMN 에 REFERENCES 를 붙일 때 기본값이 NULL 이어야 하므로 그대로 둡니다.
ALTER TABLE `agents` ADD `project_id` text REFERENCES projects(id);
--> statement-breakpoint
ALTER TABLE `agents` ADD `is_manager` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD `role_key` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_agents_user_project` ON `agents` (`user_id`,`project_id`);
