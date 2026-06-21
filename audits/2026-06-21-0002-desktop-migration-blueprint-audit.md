# Audit: 2026-06-21-0002-desktop-migration-blueprint-audit

## Date

- 2026-06-21

## Task reference

- `tasks/0002-desktop-migration-blueprint-and-phase1-setup.md`

## Repo state at audit time

- Working repository is a Cloudflare Workers-first TanStack Start application.
- Governance files required by repository standards are in place from the previous pass.
- No source behavior changes are intended or applied in this pass; this is a planning and setup pass only.

## Scope reviewed

- Platform-coupled runtime modules in `src/lib/db`, `src/lib/env`, `src/lib/storage`, `src/lib/workflow`, and `src/lib/realtime`.
- Server startup/orchestration points in `src/server.ts` and `src/lib/cron/reconcile-all.ts`.
- Cloudflare binding configuration in `wrangler.jsonc`.
- Existing investigation and deployment docs for previous workflow migration efforts.

## Findings

- `package.json` already includes import-conditions aliases that separate `workerd` and `default` runtime paths. This gives a stable seam for a desktop adapter migration.
- `#env` and `#db-client` are strict and explicit in how runtime is selected; this is both a coupling risk and a clear migration path.
- Storage and workflow subsystems are the highest-effort seam areas because they encode Cloudflare bindings and event/instance semantics.
- Realtime currently depends on a Durable Object (`RealtimeChannel`) and is currently the other major non-trivial migration surface.
- Cron/reconciliation logic is already isolated in `reconcile-all.ts` and can be scheduled in desktop runtime via a local scheduler.

## Risks

- Workflow orchestration, persistence semantics, and event-driven fan-out are high complexity and should be moved in Phase 2/3 only after stable adapter contracts exist.
- Media path migration must preserve DB-stored `/r2/<...>` URLs and sharing behavior, otherwise existing sequence media references can break.
- Any early desktop pass should remain read-only at behavior level to avoid partial runtime regressions.

## Decisions

- Use a **3-phase migration structure** with Phase 1 as strict mapping/setup only.
- Target Tauri for desktop delivery with a local Node/Bun backend process for now.
- Keep all existing behavior untouched until Phase 2 builds the first runtime adapter layer.

## Implementation notes (this pass)

- Added migration namespace file `docs/desktop-migration/desktop-migration-blueprint.md` with explicit phase plan and accept criteria.
- Updated pass-control and traceability artifacts: `tasks/TASK_INDEX.md`, `Audits_index.md`, `Repo_map.md`, `changelog.md`.
- Created task/audit records for this migration initiative.
- No code/config that changes runtime or runtime behavior was edited.

## Freshness status

- Fresh for implementation planning (`2026-06-21`).
