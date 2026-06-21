# Audit: 2026-06-21-0004-desktop-migration-phase2-local-adapter-tests

## Date

- 2026-06-21

## Task reference

- `tasks/0004-desktop-migration-phase2-local-adapter-tests.md`

## Repo state at audit time

- Phase 2 local-adapter seam compatibility work from previous passes is in place.
- Missing-binding startup/operation paths now include focused unit coverage for local runtime mode selection and local realtime message buffering behavior.

## Scope reviewed

- `src/lib/runtime-mode.ts`
- `src/lib/realtime/local-channel.ts`
- `src/lib/__tests__/runtime-mode.test.ts`
- `src/lib/realtime/__tests__/local-channel.test.ts`
- migration governance docs/artifacts (`tasks/TASK_INDEX.md`, `Audits_index.md`, `Repo_map.md`, `changelog.md`, `docs/desktop-migration/desktop-migration-blueprint.md`)

## Findings

- Runtime mode detection now has explicit unit coverage for:
  - explicit local toggles (`OPENSTORY_LOCAL_WORKFLOWS`, `OPENSTORY_RUNTIME_MODE`)
  - production/test override rules (`CLOUDFLARE_ENV`, `NODE_ENV`)
  - `requireMissingDbInDev` behavior.
- Local realtime channel tests verify:
  - ordered in-memory history collection with serialized payloads
  - history copies are snapshots (not shared references)
  - message fan-out to active listeners and automatic removal of throwing listeners.
- Migration blueprint now reflects that phase-2 local adapter tasks are complete and phase-3 can proceed.

## Risks

- Tests cover core fallback semantics but do not yet validate every missing-binding runtime path (workflow/email/API routes) in one end-to-end local run.
- Listener test uses randomized channel names; test isolation depends on UUID availability in Node runtime.

## Decisions

- Keep remaining end-to-end adapter-path validation to phase-3 runtime smoke execution as part of desktop-shell validation.
- Do not alter production-path logic; tests only lock existing behavior in local fallback branches.

## Freshness status

- Fresh for implementation planning (`2026-06-21`).
