CREATE TABLE `team_person` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`title` text,
	`bio` text,
	`portrait_key` text,
	`certifications` text DEFAULT '[]' NOT NULL,
	`highlights` text DEFAULT '[]' NOT NULL,
	`dupr_rating` real,
	`specialties` text DEFAULT '[]' NOT NULL,
	`languages` text DEFAULT '[]' NOT NULL,
	`years_coaching` integer,
	`is_public` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_person_ws_order_idx` ON `team_person` (`workspace_id`,`sort_order`);--> statement-breakpoint
ALTER TABLE `coach_profile` ADD `portrait_key` text;--> statement-breakpoint
ALTER TABLE `coach_profile` ADD `highlights` text DEFAULT '[]' NOT NULL;