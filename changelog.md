# Changelog

## 2026-06-21

### Task: 0001-update-agents-governance-standard

- Summary: Added canonical repository governance scaffold and pass workflow standards (`Agents.md`, `Audits_index.md`, `Repo_map.md`, `tasks/*`, `audits/*`).
- Files changed:
  - `Agents.md`
  - `Audits_index.md`
  - `Repo_map.md`
  - `changelog.md`
  - `tasks/TASK_INDEX.md`
  - `tasks/0001-update-agents-governance-standard.md`
  - `audits/2026-06-21-0001-agents-governance-standard-audit.md`
- Reason for change: Standardize repository governance to match required audit + implementation workflow while preserving existing project-specific constraints in legacy files.

### Task: 0002-desktop-migration-blueprint-and-phase1-setup

- Summary: Added a dedicated desktop migration blueprint and phase-1 setup planning for Tauri migration, including explicit platform seam mapping and migration acceptance criteria.
- Files changed:
  - `docs/desktop-migration/desktop-migration-blueprint.md`
  - `tasks/TASK_INDEX.md`
  - `Audits_index.md`
  - `Repo_map.md`
  - `changelog.md`
  - `audits/2026-06-21-0002-desktop-migration-blueprint-audit.md`
  - `tasks/0002-desktop-migration-blueprint-and-phase1-setup.md`
- Reason for change: Establish a bounded 3-phase migration plan (mapping first) from Cloudflare Workers to local desktop runtime without changing app behavior.

### Task: 0003-desktop-migration-phase2-local-adapters

- Summary: Completed phase-2 local adapter hardening with a shared local-runtime contract, workflow fallback registry/reconcile integration, and realtime history replay while preserving production call patterns.
- Files changed:
  - `src/lib/realtime/local-channel.ts`
  - `src/lib/runtime-mode.ts`
  - `src/lib/workflow/client.ts`
  - `src/lib/workflow/local-run-registry.ts`
  - `src/lib/workflow/local-run-registry.ts` (added persistent local workflow-run metadata store)
  - `src/lib/workflow/reconcile.ts`
  - `src/lib/workflow/trigger-bindings.ts`
  - `src/lib/realtime/index.ts`
  - `src/routes/api/realtime.ts`
  - `src/lib/services/email-service.tsx`
  - `src/server.ts`
  - `src/lib/db/client-node.ts`
  - `src/lib/storage/storage-local.ts`
  - `package.json`
  - `.gitignore`
  - `.env.example`
  - `tasks/TASK_INDEX.md`
  - `Audits_index.md`
  - `Repo_map.md`
  - `changelog.md`
  - `docs/desktop-migration/desktop-migration-blueprint.md`
  - `tasks/0003-desktop-migration-phase2-local-adapters.md`
  - `audits/2026-06-21-0003-desktop-migration-phase2-local-adapters-audit.md`
  - `.env.example`
- Reason for change: Enable phase 2 local runtime migration work (desktop/agent-host) by avoiding hard-failures from missing Cloudflare bindings outside Cloudflare production.

### Task: 0004-desktop-migration-phase2-local-adapter-tests

- Summary: Added explicit unit coverage for local runtime policy and local realtime fallback behavior so phase 2 missing-binding paths are validated without changing runtime behavior.
- Files changed:
  - `src/lib/__tests__/runtime-mode.test.ts`
  - `src/lib/realtime/__tests__/local-channel.test.ts`
  - `tasks/TASK_INDEX.md`
  - `Audits_index.md`
  - `Repo_map.md`
  - `changelog.md`
  - `docs/desktop-migration/desktop-migration-blueprint.md`
  - `tasks/0004-desktop-migration-phase2-local-adapter-tests.md`
  - `audits/2026-06-21-0004-desktop-migration-phase2-local-adapter-tests-audit.md`
- Reason for change: Lock phase 2 completion evidence with automated checks for local fallback contracts before moving to desktop shell migration.
