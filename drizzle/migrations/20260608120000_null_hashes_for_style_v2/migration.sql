-- Issue #858: null prompt-input + sheet hashes after the style `config` v2 reshape.
--
-- Reshaping styles.config from the flat v1 shape into grouped look / motion /
-- references changes the canonical hashed body, so every previously-stored hash
-- diverges from the freshly-computed one — both the prompt-input hashes
-- (PROMPT_INPUT_HASH_VERSION 3 -> 4 in src/lib/ai/input-hash.ts) and the
-- style-config hash embedded in sheet/location input hashes
-- (computeStyleConfigHash in src/lib/workflows/sheet-snapshots.ts). Without this
-- sweep, legacy rows would surface false-positive "stale" banners.
--
-- Both staleness handlers treat a null stored hash as 'untracked' (no opinion,
-- no banner), so legacy rows fall through that safe path until the user
-- regenerates — which restamps the columns with v4 / v2-style hashes. No
-- regeneration is triggered by this migration.
--
-- These are column-data UPDATEs, not a table rebuild, so they sidestep the
-- D1 / Turso ON DELETE CASCADE trap documented in CLAUDE.md.
UPDATE `frames` SET `visual_prompt_input_hash` = NULL, `motion_prompt_input_hash` = NULL;
--> statement-breakpoint
UPDATE `frame_prompt_variants` SET `input_hash` = NULL;
--> statement-breakpoint
UPDATE `talent_sheets` SET `input_hash` = NULL;
--> statement-breakpoint
UPDATE `sequence_locations` SET `reference_input_hash` = NULL;
--> statement-breakpoint
UPDATE `location_library` SET `reference_input_hash` = NULL;
