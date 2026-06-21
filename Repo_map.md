# OpenStory Repository Map

## Last reviewed

- Date: 2026-06-21
- Scope: governance-first pass (no source code changes)
- Auditor: Codex

## Project structure

- `src/` application source
  - `src/routes/` TanStack Router file-based routes and API handlers (`src/routes/api` for webhooks and auth routes)
  - `src/functions/` createServerFn business logic endpoints
  - `src/lib/` shared libraries
    - `lib/ai/` AI models/prompt schema
    - `lib/db/` Drizzle schema/clients
    - `lib/services/` core domain services
    - `lib/workflows/` Cloudflare Workflow entrypoints
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
- Root metadata/config: `wrangler.jsonc`, `.env.example`, `package.json`, `playwright.config.ts`, `vite.config.ts`, `tsconfig.json`

## Ownership and source-of-truth

- Governance: this file plus `Agents.md`, `Audits_index.md`, `tasks/TASK_INDEX.md`, and `changelog.md`.
- Detailed architecture, security, stack constraints, and workflow behavior: `CLAUDE.md`.
- Deployment/runtime policy: `wrangler.jsonc`, `playwright.config.ts`, `CONTRIBUTING.md`.
- Migration planning: `docs/desktop-migration/desktop-migration-blueprint.md`.
- Migration execution notes and decisions: task `tasks/0002-desktop-migration-blueprint-and-phase1-setup.md` and audit `audits/2026-06-21-0002-desktop-migration-blueprint-audit.md`.
- Migration integrity checks: `scripts/check-migrations.ts`.

## Notes

- No code changes were made in this pass.
- This pass introduced canonical governance files required by the new standard.
- This pass added the desktop migration planning lane and mapped the primary Cloudflare platform seams for the next pass.
