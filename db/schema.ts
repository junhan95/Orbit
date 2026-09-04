import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), title: text('title').notNull(),
  projectId: text('project_id'),
  label: text('label').notNull().default('신규'), owner: text('owner').notNull().default('Nori'),
  status: text('status').notNull().default('대기'), due: text('due').notNull().default('일정 미정'),
  accent: text('accent').notNull().default('#ff7557'), result: text('result'),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_tasks_user_status').on(table.userId, table.status), index('idx_tasks_user_created').on(table.userId, table.createdAt)]);

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(),
  description: text('description').notNull().default(''), color: text('color').notNull().default('#6651f2'),
  status: text('status').notNull().default('진행 중'), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_projects_user_updated').on(table.userId, table.updatedAt)]);

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(),
  role: text('role').notNull(), description: text('description').notNull(), instructions: text('instructions').notNull(),
  color: text('color').notNull().default('#6651f2'), isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_agents_user_role').on(table.userId, table.role)]);

export const projectAgents = sqliteTable('project_agents', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), assignedAt: integer('assigned_at').notNull(),
}, (table) => [index('idx_project_agents_user_project').on(table.userId, table.projectId)]);

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }), role: text('role').notNull(),
  content: text('content').notNull(), createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_chat_user_project_agent').on(table.userId, table.projectId, table.agentId, table.createdAt)]);

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), agentName: text('agent_name').notNull(), status: text('status').notNull(),
  prompt: text('prompt').notNull(), output: text('output'), responseId: text('response_id'),
  startedAt: integer('started_at').notNull(), completedAt: integer('completed_at'),
}, (table) => [index('idx_agent_runs_user_task').on(table.userId, table.taskId)]);
