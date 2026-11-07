CREATE TABLE `family_notification_pref` (
	`user_id` text PRIMARY KEY NOT NULL,
	`sessions` integer DEFAULT true NOT NULL,
	`session_lead` text DEFAULT '1h' NOT NULL,
	`packages` integer DEFAULT true NOT NULL,
	`enrollment` integer DEFAULT true NOT NULL,
	`progress` integer DEFAULT true NOT NULL,
	`announcements` integer DEFAULT true NOT NULL,
	`quiet_start` text DEFAULT '21:00',
	`quiet_end` text DEFAULT '07:00',
	`prompt_dismissed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `family_notification_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_key` text NOT NULL,
	`item` text NOT NULL,
	`send_after` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `family_queue_unique` ON `family_notification_queue` (`user_id`,`kind`,`ref_key`);--> statement-breakpoint
CREATE INDEX `family_queue_due_idx` ON `family_notification_queue` (`send_after`);--> statement-breakpoint
CREATE TABLE `family_push_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_success_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `family_push_subscription_endpoint_unique` ON `family_push_subscription` (`endpoint`);--> statement-breakpoint
CREATE INDEX `family_push_user_idx` ON `family_push_subscription` (`user_id`);--> statement-breakpoint
CREATE TABLE `push_sink` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`surface` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `push_sink_user_idx` ON `push_sink` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `notification_pref` ADD `enrollment_alerts` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `enrollment_decided_idx` ON `enrollment_request` (`status`,`decided_at`);