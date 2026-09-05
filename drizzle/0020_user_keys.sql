CREATE TABLE `user_keys` (
	`user_id` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`key_hint` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
