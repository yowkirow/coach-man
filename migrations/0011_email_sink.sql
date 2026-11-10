CREATE TABLE `email_sink` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`to_email` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`text` text NOT NULL,
	`html` text NOT NULL,
	`from_name` text,
	`reply_to` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_sink_to_idx` ON `email_sink` (`to_email`,`created_at`);