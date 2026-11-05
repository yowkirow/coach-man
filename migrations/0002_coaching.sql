ALTER TABLE `goal` ADD `created_by` text;--> statement-breakpoint
-- Backfill (idempotent). Before staff invites every academy had one member, its owner, so the
-- owner set every existing goal. Every workspace gets its academy profile row up front (the API
-- also creates one on first use).
UPDATE `goal` SET `created_by` = (
	SELECT m.`user_id` FROM `member` m
	WHERE m.`organization_id` = `goal`.`workspace_id` AND instr(',' || m.`role` || ',', ',owner,') > 0
	ORDER BY m.`created_at` LIMIT 1
) WHERE `created_by` IS NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `academy_profile` (`workspace_id`, `created_at`, `updated_at`)
SELECT o.`id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `organization` o;