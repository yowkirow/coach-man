CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `assessment` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`assessed_on` text NOT NULL,
	`overall_level` text,
	`notes` text,
	`lesson_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assessment_client_idx` ON `assessment` (`workspace_id`,`client_id`,`assessed_on`);--> statement-breakpoint
CREATE TABLE `assessment_score` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`score` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skill`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_score_unique` ON `assessment_score` (`assessment_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`client_id` text NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`consumed_package_id` text,
	`charge_id` text,
	`complimentary` integer DEFAULT false NOT NULL,
	`checked_in_at` integer,
	`note` text,
	`version` integer DEFAULT 0 NOT NULL,
	`last_mutation_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_lesson_client_unique` ON `attendance` (`lesson_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `attendance_client_idx` ON `attendance` (`workspace_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`data` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_ws_idx` ON `audit_log` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `charge` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`client_package_id` text,
	`attendance_id` text,
	`registration_id` text,
	`occurred_on` text NOT NULL,
	`voided_at` integer,
	`void_reason` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `charge_client_idx` ON `charge` (`workspace_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `charge_ws_date_idx` ON `charge` (`workspace_id`,`occurred_on`);--> statement-breakpoint
CREATE TABLE `client` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`email` text,
	`phone` text,
	`birth_date` text,
	`is_junior` integer DEFAULT false NOT NULL,
	`guardian_name` text,
	`guardian_phone` text,
	`guardian_email` text,
	`emergency_name` text,
	`emergency_phone` text,
	`level` text,
	`dupr_id` text,
	`dupr_rating` real,
	`dominant_hand` text,
	`paddle` text,
	`goals` text,
	`medical_notes` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text,
	`tags` text NOT NULL,
	`photo_key` text,
	`joined_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_ws_status_idx` ON `client` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `client_ws_name_idx` ON `client` (`workspace_id`,`first_name`,`last_name`);--> statement-breakpoint
CREATE INDEX `client_ws_email_idx` ON `client` (`workspace_id`,`email`);--> statement-breakpoint
CREATE INDEX `client_ws_phone_idx` ON `client` (`workspace_id`,`phone`);--> statement-breakpoint
CREATE TABLE `client_package` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`package_id` text,
	`name` text NOT NULL,
	`credits_total` integer NOT NULL,
	`lesson_kinds` text NOT NULL,
	`price_minor` integer NOT NULL,
	`purchased_on` text NOT NULL,
	`expires_on` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`package_id`) REFERENCES `package`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `client_package_client_idx` ON `client_package` (`workspace_id`,`client_id`,`status`);--> statement-breakpoint
CREATE INDEX `client_package_expiry_idx` ON `client_package` (`workspace_id`,`status`,`expires_on`);--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_package_id` text NOT NULL,
	`client_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`attendance_id` text,
	`lesson_id` text,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_package_id`) REFERENCES `client_package`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_package_idx` ON `credit_ledger` (`client_package_id`);--> statement-breakpoint
CREATE INDEX `ledger_attendance_idx` ON `credit_ledger` (`attendance_id`);--> statement-breakpoint
CREATE INDEX `ledger_client_idx` ON `credit_ledger` (`workspace_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`venue_id` text,
	`capacity` integer,
	`price_minor` integer DEFAULT 0 NOT NULL,
	`early_bird_price_minor` integer,
	`early_bird_until` text,
	`level` text,
	`age_min` integer,
	`age_max` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_ws_idx` ON `event` (`workspace_id`,`starts_on`);--> statement-breakpoint
CREATE TABLE `event_registration` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`event_id` text NOT NULL,
	`client_id` text NOT NULL,
	`status` text DEFAULT 'registered' NOT NULL,
	`price_minor` integer NOT NULL,
	`charge_id` text,
	`registered_at` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_event_client_unique` ON `event_registration` (`event_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `registration_client_idx` ON `event_registration` (`workspace_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `goal` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`target_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`achieved_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goal_client_idx` ON `goal` (`workspace_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `group_member` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`group_id` text NOT NULL,
	`client_id` text NOT NULL,
	`joined_on` text,
	`left_on` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `training_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_member_unique` ON `group_member` (`group_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `group_member_client_idx` ON `group_member` (`client_id`);--> statement-breakpoint
CREATE TABLE `idempotency_key` (
	`key` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`response` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idempotency_created_idx` ON `idempotency_key` (`created_at`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_org_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE TABLE `lesson` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`venue_id` text,
	`court` text,
	`group_id` text,
	`event_id` text,
	`rate_id` text,
	`price_minor` integer,
	`capacity` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`cancel_reason` text,
	`series_id` text,
	`occurrence_date` text,
	`detached` integer DEFAULT false NOT NULL,
	`notes` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lesson_ws_start_idx` ON `lesson` (`workspace_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `lesson_group_idx` ON `lesson` (`group_id`);--> statement-breakpoint
CREATE INDEX `lesson_event_idx` ON `lesson` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_series_occurrence_unique` ON `lesson` (`series_id`,`occurrence_date`);--> statement-breakpoint
CREATE TABLE `lesson_series` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text,
	`group_id` text,
	`venue_id` text,
	`court` text,
	`rate_id` text,
	`price_minor` integer,
	`capacity` integer,
	`weekdays` text NOT NULL,
	`start_time` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text,
	`timezone` text NOT NULL,
	`participant_ids` text NOT NULL,
	`materialized_through` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `series_ws_idx` ON `lesson_series` (`workspace_id`,`active`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_org_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_user_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE TABLE `note` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text,
	`lesson_id` text,
	`body` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `note_client_idx` ON `note` (`workspace_id`,`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `note_lesson_idx` ON `note` (`lesson_id`);--> statement-breakpoint
CREATE TABLE `notification_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_key` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_log_unique` ON `notification_log` (`user_id`,`kind`,`ref_key`);--> statement-breakpoint
CREATE TABLE `notification_pref` (
	`user_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`session_reminder_minutes` integer DEFAULT 30,
	`daily_digest_time` text DEFAULT '07:00',
	`package_expiry_days` integer DEFAULT 7 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `package` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`credits` integer NOT NULL,
	`lesson_kinds` text NOT NULL,
	`price_minor` integer NOT NULL,
	`validity_days` integer,
	`description` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `package_ws_idx` ON `package` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkey_user_idx` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE INDEX `passkey_credential_idx` ON `passkey` (`credential_id`);--> statement-breakpoint
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`method` text NOT NULL,
	`paid_on` text NOT NULL,
	`reference` text,
	`note` text,
	`voided_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_client_idx` ON `payment` (`workspace_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `payment_ws_date_idx` ON `payment` (`workspace_id`,`paid_on`);--> statement-breakpoint
CREATE TABLE `payment_allocation` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `payment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`charge_id`) REFERENCES `charge`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `allocation_charge_idx` ON `payment_allocation` (`charge_id`);--> statement-breakpoint
CREATE INDEX `allocation_client_idx` ON `payment_allocation` (`workspace_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `push_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_success_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscription_endpoint_unique` ON `push_subscription` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_user_idx` ON `push_subscription` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`duration_minutes` integer DEFAULT 60 NOT NULL,
	`price_minor` integer NOT NULL,
	`unit` text DEFAULT 'session' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rate_ws_idx` ON `rate` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `rating_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`source` text NOT NULL,
	`value` real NOT NULL,
	`recorded_on` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rating_client_idx` ON `rating_snapshot` (`workspace_id`,`client_id`,`recorded_on`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `skill` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_ws_idx` ON `skill` (`workspace_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `training_group` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`level` text,
	`description` text,
	`color` text,
	`capacity` integer,
	`default_rate_id` text,
	`default_venue_id` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_ws_idx` ON `training_group` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `venue` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`court_count` integer,
	`notes` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `venue_ws_idx` ON `venue` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`sport` text DEFAULT 'pickleball' NOT NULL,
	`payment_methods` text NOT NULL,
	`no_show_uses_credit` integer DEFAULT true NOT NULL,
	`late_cancel_uses_credit` integer DEFAULT true NOT NULL,
	`late_cancel_hours` integer DEFAULT 24 NOT NULL,
	`default_session_minutes` integer DEFAULT 60 NOT NULL,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`onboarded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
