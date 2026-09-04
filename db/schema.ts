import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), title: text('title').notNull(),
  label: text('label').notNull().default('신규'), owner: text('owner').notNull().default('Nori'),
  status: text('status').notNull().default('대기'), due: text('due').notNull().default('일정 미정'),
  accent: text('accent').notNull().default('#ff7557'), result: text('result'),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_tasks_user_status').on(table.userId, table.status), index('idx_tasks_user_created').on(table.userId, table.createdAt)]);

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), agentName: text('agent_name').notNull(), status: text('status').notNull(),
  prompt: text('prompt').notNull(), output: text('output'), responseId: text('response_id'),
  startedAt: integer('started_at').notNull(), completedAt: integer('completed_at'),
}, (table) => [index('idx_agent_runs_user_task').on(table.userId, table.taskId)]);
