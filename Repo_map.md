# OpenStory Repository Map

## Last reviewed

- Date: 2026-06-21
- Scope: phase 2 desktop migration cutover readiness and local bootstrap hardening, then Phase 3 launch prep
- Auditor: Codex

## Project structure

- `src/` application source
  - `src/routes/` TanStack Router file-based routes and API handlers (`src/routes/api` for webhooks and auth routes)
  - `src/functions/` createServerFn business logic endpoints
  - `src/lib/` shared libraries
    - `lib/ai/` AI models/prompt schema
    - `lib/db/` Drizzle schema/clients
    - `lib/storage/` cloud/local storage adapters and upload utilities
    - `lib/services/` domain services (`email-service.tsx` now local-safe when binding is absent)
    - `lib/storage/` local filesystem + R2 adapters (`storage-local.ts` now active under non-workerd runtime)
    - `lib/workflows/` Cloudflare Workflow adapters and trigger mapping
    - `lib/realtime/` typed realtime schema, channel helpers, and SSE client/broker adapters
    - `lib/runtime-mode.ts` centralizes local-mode detection for seam adapters.
    - `lib/auth/` authentication wiring
  - `src/components/` React/shadcn UI layer
  - `src/workers/` worker bootstrap helpers and integrations
- `vite.config.desktop.ts` (desktop-only Vite config and local output target)
- `src/server-desktop.ts` (desktop request entrypoint without Worker exports)
- `src-tauri/` Tauri shell project (Rust host + config)
- `scripts/` developer CLI utilities and environment/bootstrap scripts
- `drizzle/` Drizzle schemas and generated SQL migrations
- `e2e/` Playwright end-to-end suites
- `public/` static assets
- `workers/` cloud platform helpers
- `docs/desktop-migration/` desktop migration planning artifacts (new)
- `.cursor/rules/` editor instructions and conventions
- `.claude/` agent/hook instructions and local CI/quality overrides
- `.github/` CI/CD and workflow definitions
- `tasks/` task index plus task files
- `audits/` audit index and historical audit records
- `src/lib/__tests__/` and `src/lib/realtime/__tests__/` local runtime behavior test suites
- Root metadata/config: `wrangler.jsonc`, `.env.example`, `package.json`, `playwright.config.ts`, `vite.config.ts`, `tsconfig.json`

## Ownership and source-of-truth

- Governance: this file plus `Agents.md`, `Audits_index.md`, `tasks/TASK_INDEX.md`, and `changelog.md`.
- Detailed architecture, security, stack constraints, and workflow behavior: `CLAUDE.md`.
- Deployment/runtime policy: `wrangler.jsonc`, `playwright.config.ts`, `CONTRIBUTING.md`.
- Migration planning: `docs/desktop-migration/desktop-migration-blueprint.md`.
- Migration execution notes and decisions:
  - `tasks/0002-desktop-migration-blueprint-and-phase1-setup.md`
  - `audits/2026-06-21-0002-desktop-migration-blueprint-audit.md`
  - `tasks/0003-desktop-migration-phase2-local-adapters.md`
  - `audits/2026-06-21-0003-desktop-migration-phase2-local-adapters-audit.md`
  - `tasks/0004-desktop-migration-phase2-local-adapter-tests.md`
  - `audits/2026-06-21-0004-desktop-migration-phase2-local-adapter-tests-audit.md`
- `tasks/0005-desktop-migration-phase2-desktop-shell.md`
- `audits/2026-06-21-0005-desktop-migration-phase2-desktop-shell-audit.md`
- Migration integrity checks: `scripts/check-migrations.ts`.
- Local cutover evidence package: `docs/desktop-migration/desktop-migration-blueprint.md`, `tasks/0007-desktop-migration-phase2-cutover-readiness.md`, `audits/2026-06-21-0007-desktop-migration-phase2-cutover-readiness-audit.md`.
- Local bootstrap evidence extension: `tasks/0008-desktop-migration-phase2-local-file-bootstrap.md`, `audits/2026-06-21-0008-desktop-migration-phase2-local-file-bootstrap-audit.md`, `scripts/migrate-local-file-db.ts`.
- Phase boundary:
  - Phase 1 and Phase 2 runtime adapter work are complete and governance-tracked.
  - Phase 3 is now explicitly in-flight and begins with local desktop launch validation and end-to-end package validation.

## Notes

- Phase 1 mapped Cloudflare platform seams and added migration planning files.
- Phase 2 added local-safe behavior for workflow dispatch, workflow-run reconciliation, realtime channel emit/history + local SSE replay, DB client bootstrap, storage adapter selection, and email transport while preserving existing production paths.
- Local workflow-run state is now persisted to disk in phase 2 so local runtime can recover in-flight/local metadata after restart.
- Phase 2 now has explicit local runtime coverage for runtime-mode detection and local realtime fan-out/history behavior.
- This pass does not remove Cloudflare runtime; it establishes the local adapter compatibility baseline needed before full desktop runtime cutover in phase 3.
- Phase 3 now has local desktop shell scaffolding and local request entry in `src/server-desktop.ts`, with desktop-specific Vite output in `dist-desktop`.
- Desktop bootstrap hardening (phase 2): `src/server-desktop.ts` now runs local seed/reconcile initialization in a non-blocking path and explicitly bypasses Vite runtime endpoints so `/@vite/client` and similar requests are no longer held up on startup.
