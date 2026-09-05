-- 선언적 기억 (Hermes MEMORY.md / USER.md 대응). 문자 예산·승인 게이트·위협 스캔은 lib/memory.ts 가 맡습니다.
-- 0006/0007 과 같은 방식으로 실제 변경분만 손으로 적었습니다 (drizzle-kit generate 는 기존 테이블을 재생성하려 하므로).

CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text,
	`content` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_memories_user_scope` ON `memories` (`user_id`,`scope`,`scope_id`,`status`);
