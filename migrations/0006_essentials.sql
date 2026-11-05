ALTER TABLE `announcement` ADD `notified_at` integer;--> statement-breakpoint
CREATE INDEX `announcement_due_idx` ON `announcement` (`notified_at`,`published_at`);--> statement-breakpoint
ALTER TABLE `client` ADD `safety_updated_at` integer;--> statement-breakpoint
ALTER TABLE `client` ADD `safety_updated_by` text;--> statement-breakpoint
ALTER TABLE `client` ADD `safety_updated_relation` text;--> statement-breakpoint
CREATE UNIQUE INDEX `authorized_pickup_photo_key_idx` ON `authorized_pickup` (`photo_key`);--> statement-breakpoint
-- Hand-written, idempotent: announcements already live before this migration (there's no way to make one before WS5a, so normally none) count as announced, so the first cron run doesn't announce old news.
UPDATE `announcement` SET `notified_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `notified_at` IS NULL AND `published_at` IS NOT NULL AND `published_at` <= CAST(strftime('%s', 'now') AS INTEGER) * 1000;
