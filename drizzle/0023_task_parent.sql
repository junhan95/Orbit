-- 매니저가 위임한 카드가 어느 매니저 카드(지시)에서 나왔는지. 대화에서 위임한 카드는 NULL.
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT;
--> statement-breakpoint
CREATE INDEX idx_tasks_user_parent ON tasks (user_id, parent_task_id);
