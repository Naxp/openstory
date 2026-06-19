CREATE TABLE `scenes` (
	`id` text PRIMARY KEY,
	`sequence_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`location` text,
	`time_of_day` text,
	`story_beat` text,
	`title` text,
	`continuity` text,
	`music_design` text,
	`original_script` text,
	`image_model` text(100),
	`video_model` text(100),
	`video_url` text,
	`video_path` text,
	`video_status` text DEFAULT 'pending',
	`video_workflow_run_id` text,
	`video_generated_at` integer,
	`video_error` text,
	`video_input_hash` text,
	`render_strategy` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_scenes_sequence_id_sequences_id_fk` FOREIGN KEY (`sequence_id`) REFERENCES `sequences`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `shots` ADD `scene_id` text REFERENCES scenes(id);--> statement-breakpoint
ALTER TABLE `shots` ADD `shot_number` integer;--> statement-breakpoint
CREATE INDEX `idx_scenes_sequence_order` ON `scenes` (`sequence_id`,`order_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `scenes_sequence_id_order_index_key` ON `scenes` (`sequence_id`,`order_index`);