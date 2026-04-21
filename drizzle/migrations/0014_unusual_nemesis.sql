ALTER TABLE `frames` ADD `graphics_overlays` text;--> statement-breakpoint
ALTER TABLE `frames` ADD `composited_video_url` text;--> statement-breakpoint
ALTER TABLE `frames` ADD `composited_video_path` text;--> statement-breakpoint
ALTER TABLE `frames` ADD `composited_video_status` text;--> statement-breakpoint
ALTER TABLE `frames` ADD `composited_video_workflow_run_id` text;--> statement-breakpoint
ALTER TABLE `frames` ADD `composited_video_generated_at` integer;--> statement-breakpoint
ALTER TABLE `frames` ADD `composited_video_error` text;--> statement-breakpoint
ALTER TABLE `sequences` ADD `intro_overlay` text;--> statement-breakpoint
ALTER TABLE `sequences` ADD `outro_overlay` text;