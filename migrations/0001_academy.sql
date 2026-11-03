CREATE TABLE `academy_profile` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`tagline` text,
	`about` text,
	`contact_phone` text,
	`contact_email` text,
	`address` text,
	`map_url` text,
	`socials` text DEFAULT '{}' NOT NULL,
	`logo_key` text,
	`cover_key` text,
	`payment_instructions` text,
	`payment_qr_key` text,
	`policies` text,
	`enrollment_open` integer DEFAULT false NOT NULL,
	`listed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `announcement` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`audience` text DEFAULT 'all' NOT NULL,
	`audience_id` text,
	`pinned` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`expires_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `announcement_ws_published_idx` ON `announcement` (`workspace_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `authorized_pickup` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`relationship` text,
	`phone` text,
	`photo_key` text,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `authorized_pickup_client_idx` ON `authorized_pickup` (`client_id`);--> statement-breakpoint
CREATE TABLE `client_access` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`relation` text NOT NULL,
	`granted_by` text,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_access_client_user_unique` ON `client_access` (`client_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `client_access_user_idx` ON `client_access` (`user_id`);--> statement-breakpoint
CREATE TABLE `client_coach` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`coach_user_id` text NOT NULL,
	`role` text NOT NULL,
	`started_on` text NOT NULL,
	`ended_on` text,
	`assigned_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_coach_client_idx` ON `client_coach` (`workspace_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `client_coach_coach_idx` ON `client_coach` (`workspace_id`,`coach_user_id`,`ended_on`);--> statement-breakpoint
CREATE TABLE `coach_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text,
	`title` text,
	`bio` text,
	`photo_key` text,
	`certifications` text DEFAULT '[]' NOT NULL,
	`dupr_rating` real,
	`specialties` text DEFAULT '[]' NOT NULL,
	`languages` text DEFAULT '[]' NOT NULL,
	`years_coaching` integer,
	`is_public` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coach_profile_ws_user_unique` ON `coach_profile` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `consent_document` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`applies_to` text DEFAULT 'all' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `consent_document_ws_idx` ON `consent_document` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `consent_signature` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`document_version` integer NOT NULL,
	`client_id` text NOT NULL,
	`signed_by_user_id` text,
	`signer_name` text NOT NULL,
	`relation` text NOT NULL,
	`signed_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`enrollment_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `consent_document`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `consent_signature_client_idx` ON `consent_signature` (`client_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `enrollment_request` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`package_id` text,
	`program_id` text,
	`event_id` text,
	`start_month` text,
	`lesson_id` text,
	`answers` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`client_package_id` text,
	`registration_id` text,
	`charge_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `enrollment_ws_status_idx` ON `enrollment_request` (`workspace_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `enrollment_client_idx` ON `enrollment_request` (`client_id`);--> statement-breakpoint
CREATE TABLE `invite` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`email` text,
	`role` text,
	`client_id` text,
	`relation` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_by` text,
	`accepted_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_tokenHash_unique` ON `invite` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invite_ws_kind_idx` ON `invite` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE TABLE `payment_submission` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`submitted_by` text NOT NULL,
	`enrollment_id` text,
	`amount_minor` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`paid_on` text NOT NULL,
	`proof_key` text,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`reject_reason` text,
	`payment_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_submission_ws_status_idx` ON `payment_submission` (`workspace_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_submission_client_idx` ON `payment_submission` (`client_id`);--> statement-breakpoint
ALTER TABLE `assessment` ADD `shared_with_family` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `client` ADD `shirt_size` text;--> statement-breakpoint
ALTER TABLE `client_package` ADD `start_month` text;--> statement-breakpoint
ALTER TABLE `client_package` ADD `uniform_size` text;--> statement-breakpoint
ALTER TABLE `client_package` ADD `uniform_issued_at` integer;--> statement-breakpoint
ALTER TABLE `client_package` ADD `enrollment_id` text;--> statement-breakpoint
ALTER TABLE `event` ADD `coach_user_id` text;--> statement-breakpoint
ALTER TABLE `event` ADD `assistant_coach_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `lesson` ADD `coach_user_id` text;--> statement-breakpoint
ALTER TABLE `lesson` ADD `assistant_coach_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `lesson_coach_idx` ON `lesson` (`workspace_id`,`coach_user_id`,`starts_at`);--> statement-breakpoint
ALTER TABLE `lesson_series` ADD `coach_user_id` text;--> statement-breakpoint
ALTER TABLE `lesson_series` ADD `assistant_coach_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `note` ADD `visibility` text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE `note` ADD `kind` text DEFAULT 'comment' NOT NULL;--> statement-breakpoint
ALTER TABLE `note` ADD `edited_at` integer;--> statement-breakpoint
ALTER TABLE `package` ADD `program_id` text;--> statement-breakpoint
ALTER TABLE `package` ADD `coach_user_id` text;--> statement-breakpoint
ALTER TABLE `package` ADD `sessions_label` text;--> statement-breakpoint
ALTER TABLE `package` ADD `validity_mode` text DEFAULT 'days' NOT NULL;--> statement-breakpoint
ALTER TABLE `package` ADD `inclusions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `package` ADD `audience` text;--> statement-breakpoint
ALTER TABLE `package` ADD `commitment_note` text;--> statement-breakpoint
ALTER TABLE `package` ADD `includes_uniform` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `package` ADD `asks_self_rating` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `package` ADD `is_public` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `package` ADD `highlight` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `package` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rate` ADD `coach_user_id` text;--> statement-breakpoint
ALTER TABLE `training_group` ADD `coach_user_id` text;--> statement-breakpoint
ALTER TABLE `training_group` ADD `assistant_coach_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `training_group` ADD `is_public` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `training_group` ADD `public_description` text;--> statement-breakpoint
ALTER TABLE `training_group` ADD `schedule_note` text;--> statement-breakpoint
ALTER TABLE `training_group` ADD `age_min` integer;--> statement-breakpoint
ALTER TABLE `training_group` ADD `age_max` integer;--> statement-breakpoint
ALTER TABLE `training_group` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill (hand-written, idempotent): every existing workspace's owner becomes the lead coach of
-- its sessions, series, groups, and events, and the primary coach of its clients; every existing
-- member gets a coach profile. Existing notes are already coaches-only (visibility defaults to 'staff').
UPDATE `lesson` SET `coach_user_id` = (
	SELECT m.`user_id` FROM `member` m
	WHERE m.`organization_id` = `lesson`.`workspace_id` AND instr(',' || m.`role` || ',', ',owner,') > 0
	ORDER BY m.`created_at` LIMIT 1
) WHERE `coach_user_id` IS NULL;--> statement-breakpoint
UPDATE `lesson_series` SET `coach_user_id` = (
	SELECT m.`user_id` FROM `member` m
	WHERE m.`organization_id` = `lesson_series`.`workspace_id` AND instr(',' || m.`role` || ',', ',owner,') > 0
	ORDER BY m.`created_at` LIMIT 1
) WHERE `coach_user_id` IS NULL;--> statement-breakpoint
UPDATE `training_group` SET `coach_user_id` = (
	SELECT m.`user_id` FROM `member` m
	WHERE m.`organization_id` = `training_group`.`workspace_id` AND instr(',' || m.`role` || ',', ',owner,') > 0
	ORDER BY m.`created_at` LIMIT 1
) WHERE `coach_user_id` IS NULL;--> statement-breakpoint
UPDATE `event` SET `coach_user_id` = (
	SELECT m.`user_id` FROM `member` m
	WHERE m.`organization_id` = `event`.`workspace_id` AND instr(',' || m.`role` || ',', ',owner,') > 0
	ORDER BY m.`created_at` LIMIT 1
) WHERE `coach_user_id` IS NULL;--> statement-breakpoint
INSERT INTO `client_coach` (`id`, `workspace_id`, `client_id`, `coach_user_id`, `role`, `started_on`, `ended_on`, `assigned_by`, `created_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	c.`workspace_id`,
	c.`id`,
	o.`user_id`,
	'primary',
	coalesce(c.`joined_on`, date(c.`created_at` / 1000, 'unixepoch')),
	NULL,
	NULL,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `client` c
JOIN (
	SELECT m.`organization_id`, m.`user_id` FROM `member` m
	WHERE instr(',' || m.`role` || ',', ',owner,') > 0
	AND m.`created_at` = (
		SELECT min(m2.`created_at`) FROM `member` m2
		WHERE m2.`organization_id` = m.`organization_id` AND instr(',' || m2.`role` || ',', ',owner,') > 0
	)
	GROUP BY m.`organization_id`
) o ON o.`organization_id` = c.`workspace_id`
WHERE NOT EXISTS (
	SELECT 1 FROM `client_coach` cc
	WHERE cc.`client_id` = c.`id` AND cc.`role` = 'primary' AND cc.`ended_on` IS NULL
);--> statement-breakpoint
INSERT INTO `coach_profile` (`id`, `workspace_id`, `user_id`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	m.`organization_id`,
	m.`user_id`,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `member` m
WHERE NOT EXISTS (
	SELECT 1 FROM `coach_profile` cp
	WHERE cp.`workspace_id` = m.`organization_id` AND cp.`user_id` = m.`user_id`
)
GROUP BY m.`organization_id`, m.`user_id`;