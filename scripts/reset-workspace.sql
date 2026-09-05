-- 워크스페이스 초기화 (1회성).
-- 프로젝트 매니저 중심 구조로 넘어오면서 기존 프로젝트·업무·에이전트를 모두 지웁니다.
-- 사용량 이력(usage_events)은 비용 추적을 위해 남깁니다.
--
--   npx wrangler d1 execute DB --local --config dist/server/wrangler.json \
--     --persist-to .wrangler/state --file ./scripts/reset-workspace.sql
--
-- 자식 → 부모 순서로 지웁니다 (FK).
DELETE FROM task_field_values;
--> statement-breakpoint
DELETE FROM task_comments;
--> statement-breakpoint
DELETE FROM subtasks;
--> statement-breakpoint
DELETE FROM agent_runs;
--> statement-breakpoint
DELETE FROM chat_messages;
--> statement-breakpoint
DELETE FROM recall_docs;
--> statement-breakpoint
DELETE FROM memories;
--> statement-breakpoint
DELETE FROM project_fields;
--> statement-breakpoint
DELETE FROM project_folders;
--> statement-breakpoint
DELETE FROM project_agents;
--> statement-breakpoint
DELETE FROM tasks;
--> statement-breakpoint
DELETE FROM agents;
--> statement-breakpoint
DELETE FROM projects;
