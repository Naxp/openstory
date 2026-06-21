# OpenStory Repository Map

## Last reviewed

- Date: 2026-06-21
- Scope: phase 2 local adapter validation tests + seam-safe desktop/runtime launch preparation
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
- Migration integrity checks: `scripts/check-migrations.ts`.

## Notes

- Phase 1 mapped Cloudflare platform seams and added migration planning files.
- Phase 2 added local-safe behavior for workflow dispatch, workflow-run reconciliation, realtime channel emit/history + local SSE replay, DB client bootstrap, storage adapter selection, and email transport while preserving existing production paths.
- Local workflow-run state is now persisted to disk in phase 2 so local runtime can recover in-flight/local metadata after restart.
- Phase 2 now has explicit local runtime coverage for runtime-mode detection and local realtime fan-out/history behavior.
- This pass does not remove Cloudflare runtime; it establishes the local adapter compatibility baseline needed before full desktop runtime cutover in phase 3.
