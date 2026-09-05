CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`email` text,
	`company` text,
	`department` text,
	`title` text,
	`phone` text,
	`bio` text,
	`avatar` text,
	`updated_at` integer NOT NULL
);
