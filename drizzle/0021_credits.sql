CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`bucket` text NOT NULL,
	`amount_mc` integer NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`meta` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_credit_ledger_user` ON `credit_ledger` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_credit_ledger_trial` ON `credit_ledger` (`user_id`) WHERE `kind` = 'trial';
--> statement-breakpoint
CREATE TABLE `credit_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_id` text NOT NULL,
	`amount_mc` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_credit_holds_run` ON `credit_holds` (`run_id`);
--> statement-breakpoint
CREATE INDEX `idx_credit_holds_user_status` ON `credit_holds` (`user_id`,`status`);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`payment_key` text,
	`amount_krw` integer NOT NULL,
	`credits_mc` integer NOT NULL,
	`bonus_mc` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`method` text,
	`receipt_url` text,
	`raw` text,
	`created_at` integer NOT NULL,
	`approved_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_payments_user` ON `payments` (`user_id`,`created_at`);
