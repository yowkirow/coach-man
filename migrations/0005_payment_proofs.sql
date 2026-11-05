ALTER TABLE `payment_submission` ADD `resubmit_of` text;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_submission_proof_key_idx` ON `payment_submission` (`proof_key`);--> statement-breakpoint
CREATE INDEX `payment_submission_payment_idx` ON `payment_submission` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payment_submission_enrollment_idx` ON `payment_submission` (`enrollment_id`);