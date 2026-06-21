# Task: 0002-desktop-migration-blueprint-and-phase1-setup

**Task Name:** Desktop migration blueprint + Phase 1 mapping/setup

- Date: 2026-06-21
- Goal: define a concrete 3-phase migration blueprint from Cloudflare Workers to Tauri desktop and complete all pass tracking for phase-1 mapping/setup artifacts.
- Scope: documentation + governance tracking for migration planning only. No runtime or behavior changes.

## Checklist

- [x] Read governing instructions (`Agents.md`, `.\CLAUDE.md`, `Repo_map.md`, existing task/audit/changelog artifacts)
- [x] Map current Cloudflare coupling points across env/db/storage/workflow/realtime/server glue
- [x] Create a dedicated migration blueprint namespace in `docs/`
- [x] Add explicit 3-phase migration plan with acceptance criteria
- [x] Create/update this task file with complete checklist and references
- [x] Create audit entry in `audits/` for the pass
- [x] Update `tasks/TASK_INDEX.md` with new pass reference
- [x] Update `Audits_index.md` with new audit record
- [x] Update `Repo_map.md` to capture ownership/source-of-truth shifts
- [x] Update `changelog.md` with pass summary
- [x] Keep all changes documentation and governance-only (no feature code edits)

## Files reviewed

- `Agents.md`
- `CLAUDE.md`
- `Repo_map.md`
- `Audits_index.md`
- `changelog.md`
- `tasks/TASK_INDEX.md`
- `package.json`
- `wrangler.jsonc`
- `src/lib/db/client-d1.ts`
- `src/lib/db/client-node.ts`
- `src/lib/env/cloudflare.ts`
- `src/lib/storage/storage-cloudflare.ts`
- `src/lib/storage/storage-stub.ts`
- `src/lib/storage/upload-target.ts`
- `src/lib/storage/buckets.ts`
- `src/lib/workflow/client.ts`
- `src/lib/workflow/trigger-bindings.ts`
- `src/lib/workflow/types.ts`
- `src/lib/realtime/realtime-channel.do.ts`
- `src/routes/api/realtime.ts`
- `src/routes/r2.$.ts`
- `src/server.ts`
- `src/lib/cron/reconcile-all.ts`
- `docs/investigations/cloudflare-workflows.md`
- `docs/investigations/cloudflare-workflows-poc.md`
- `docs/deployment/cloudflare.md`
- `tasks/0001-update-agents-governance-standard.md`
- `audits/2026-06-21-0001-agents-governance-standard-audit.md`

## Files changed

- `docs/desktop-migration/desktop-migration-blueprint.md`
- `tasks/TASK_INDEX.md`
- `Audits_index.md`
- `Repo_map.md`
- `changelog.md`
- `audits/2026-06-21-0002-desktop-migration-blueprint-audit.md`
- `tasks/0002-desktop-migration-blueprint-and-phase1-setup.md`

## Audit reference

- `audits/2026-06-21-0002-desktop-migration-blueprint-audit.md`

## Changelog reference

- `changelog.md`

## Completion status

- Completed
