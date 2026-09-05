-- 프로젝트에 연결된 사용자 컴퓨터의 폴더 메타데이터.
-- 실제 디렉터리 핸들은 브라우저 IndexedDB 에 있고(서버는 Workers 라 파일시스템이 없음),
-- 여기에는 "어떤 프로젝트에 어떤 이름의 폴더가 붙어 있는가"만 남습니다.
CREATE TABLE IF NOT EXISTS `project_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`path_hint` text DEFAULT '' NOT NULL,
	`file_count` integer DEFAULT 0 NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_folders_user_project` ON `project_folders` (`user_id`,`project_id`);
