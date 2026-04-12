CREATE TABLE `workflow_definitions` (
	`id` text PRIMARY KEY,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`definition` text NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_event` text,
	`enabled` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_workflow_definitions_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workflow_definitions_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY,
	`workflow_definition_id` text NOT NULL,
	`team_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`trigger_data` text,
	`step_results` text,
	`error` text,
	`qstash_workflow_run_id` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_workflow_runs_workflow_definition_id_workflow_definitions_id_fk` FOREIGN KEY (`workflow_definition_id`) REFERENCES `workflow_definitions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workflow_runs_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_wf_def_team_id` ON `workflow_definitions` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_wf_def_trigger` ON `workflow_definitions` (`team_id`,`trigger_type`,`trigger_event`);--> statement-breakpoint
CREATE INDEX `idx_wf_run_def_id` ON `workflow_runs` (`workflow_definition_id`);--> statement-breakpoint
CREATE INDEX `idx_wf_run_team_id` ON `workflow_runs` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_wf_run_status` ON `workflow_runs` (`status`);