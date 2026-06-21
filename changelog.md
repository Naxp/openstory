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

### Task: 0005-desktop-migration-phase2-desktop-shell

- Summary: Added desktop-only runtime scaffolding with local request-entry separation from Worker boot, desktop Vite config, and a minimal Tauri shell scaffold.
- Files changed:
  - `vite.config.desktop.ts`
  - `src/server-desktop.ts`
  - `src-tauri/Cargo.toml`
  - `src-tauri/src/main.rs`
  - `src-tauri/tauri.conf.json`
  - `package.json`
  - `.gitignore`
  - `tasks/TASK_INDEX.md`
  - `Audits_index.md`
  - `Repo_map.md`
  - `docs/desktop-migration/desktop-migration-blueprint.md`
  - `tasks/0005-desktop-migration-phase2-desktop-shell.md`
  - `audits/2026-06-21-0005-desktop-migration-phase2-desktop-shell-audit.md`
- Reason for change: Continue migration by introducing a concrete local desktop bootstrap path that keeps Cloudflare Worker entrypoints isolated.

### Task: 0006-desktop-migration-phase2-runtime-stability

- Summary: Fixed desktop startup by repairing corrupted LogTape logger initialization and making logging configuration resilient to repeated initialization in local runtime entrypoints.
- Files changed:
  - `src/lib/observability/logger.ts`
  - `Audits_index.md`
  - `tasks/TASK_INDEX.md`
  - `changelog.md`
  - `tasks/0006-desktop-migration-phase2-runtime-stability.md`
  - `audits/2026-06-21-0006-desktop-migration-phase2-runtime-stability-audit.md`
- Reason for change: Prevent desktop Vite/SSR entry crashes caused by duplicate LogTape configuration and syntax corruption in the logging setup block.

### Task: 0007-desktop-migration-phase2-cutover-readiness

- Summary: Formalized Phase 2 completion as a cutover-ready documentation bundle: updated migration roadmap status, governance tracking, and governance indexes so Phase 3 can execute from a defined handoff point.
- Files changed:
  - `tasks/TASK_INDEX.md`
  - `Audits_index.md`
  - `Repo_map.md`
  - `docs/desktop-migration/desktop-migration-blueprint.md`
  - `changelog.md`
  - `tasks/0007-desktop-migration-phase2-cutover-readiness.md`
  - `audits/2026-06-21-0007-desktop-migration-phase2-cutover-readiness-audit.md`
- Reason for change: Preserve an explicit handoff artifact for governance, auditability, and next-phase execution clarity before desktop runtime launch validation.

### Task: 0008-desktop-migration-phase2-local-file-bootstrap

- Summary: Hardened local startup bootstrap by fixing file-backed libSQL migration path handling and consolidating desktop scripts so local DB migrations execute deterministically before desktop Vite and build steps.
- Files changed:
  - `scripts/migrate-local-file-db.ts`
  - `package.json`
  - `tasks/TASK_INDEX.md`
  - `Audits_index.md`
  - `Repo_map.md`
  - `changelog.md`
  - `docs/desktop-migration/desktop-migration-blueprint.md`
  - `tasks/0008-desktop-migration-phase2-local-file-bootstrap.md`
  - `audits/2026-06-21-0008-desktop-migration-phase2-local-file-bootstrap-audit.md`
- Reason for change: Remove startup ambiguity in local desktop mode by making file-backed DB bootstrap deterministic and eliminating duplicate script ownership in package.json.

### Task: 0009-desktop-migration-phase2-desktop-bootstrap-unblock

- Summary: Prevented local desktop startup hangs by decoupling template seed/reconcile bootstrap from Vite request responses and skipping bootstrap work for Vite runtime endpoints.
- Files changed:
  - `src/server-desktop.ts`
  - `tasks/TASK_INDEX.md`
  - `Audits_index.md`
  - `changelog.md`
  - `Repo_map.md`
  - `tasks/0009-desktop-migration-phase2-desktop-bootstrap-unblock.md`
  - `audits/2026-06-21-0009-desktop-migration-phase2-desktop-bootstrap-unblock-audit.md`
- Reason for change: Eliminate request blocking during local desktop boot so `/`, `/@vite/client`, and API routes stay responsive while seed initialization proceeds asynchronously.
