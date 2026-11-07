CREATE TABLE `consent_document_version` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `consent_document`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consent_document_version_unique` ON `consent_document_version` (`document_id`,`version`);--> statement-breakpoint
ALTER TABLE `client_package` ADD `includes_uniform` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `consent_signature_ws_idx` ON `consent_signature` (`workspace_id`,`document_id`);