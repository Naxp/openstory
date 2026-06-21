# Task: 0009-desktop-migration-phase2-desktop-bootstrap-unblock

- Task Name: Desktop migration phase 2 - unblock desktop bootstrap for Vite dev endpoints
- Date: 2026-06-21
- Goal: prevent `/` and `/@vite/client` desktop requests from hanging by moving desktop seed/bootstrap off the request hot path and skipping bootstrap for Vite runtime endpoints.
- Scope: `src/server-desktop.ts` startup sequence and Phase 2 governance tracking artifacts.

## Checklist

- [x] Add non-blocking seed/bootstrap invocation in `src/server-desktop.ts`.
- [x] Skip desktop seed/reconcile bootstrap for Vite runtime endpoints and static asset paths.
- [x] Preserve background reconcile interval behavior once bootstrap is requested.
- [x] Document the change in `tasks/TASK_INDEX.md` and add this task file.
- [x] Add an audit file and wire it into `Audits_index.md`.
- [x] Add a changelog entry for the blocker fix.

## Files reviewed

- `src/server-desktop.ts`
- `tasks/TASK_INDEX.md`
- `Audits_index.md`
- `changelog.md`
- `Repo_map.md`
- `Agents.md`

## Files changed

- `src/server-desktop.ts`
- `tasks/TASK_INDEX.md`
- `Audits_index.md`
- `changelog.md`
- `Repo_map.md`
- `tasks/0009-desktop-migration-phase2-desktop-bootstrap-unblock.md`
- `audits/2026-06-21-0009-desktop-migration-phase2-desktop-bootstrap-unblock-audit.md`

## Audit reference

- `audits/2026-06-21-0009-desktop-migration-phase2-desktop-bootstrap-unblock-audit.md`

## Changelog reference

- `changelog.md`

## Completion status

- Completed
