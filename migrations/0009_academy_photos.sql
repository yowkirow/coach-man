CREATE TABLE `academy_photo` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`caption` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academy_photo_key_unique` ON `academy_photo` (`key`);--> statement-breakpoint
CREATE INDEX `academy_photo_ws_order_idx` ON `academy_photo` (`workspace_id`,`sort_order`);