# OpenStory Desktop Migration Blueprint (Tauri-first, no Cloudflare runtime dependency)

Date: 2026-06-21

Scope: map and execute migration from Cloudflare Workers to a local desktop-first app while preserving the TanStack UI and domain model.

## Why this migration

Current app behavior is tightly coupled to Cloudflare primitives by design:
- `src/lib/db/client-d1.ts` + `wrangler.jsonc` D1 bindings
- `#env` and `cloudflare:workers` env accessors
- `#storage` Cloudflare R2 implementation
- `src/lib/workflow/*` CF Workflow bindings and trigger registry
- `src/lib/realtime/realtime-channel.do.ts` durable object realtime broker
- `src/server.ts` cron + seeded startup logic + exported CF workflow/DO classes

This blueprint sets a migration path to a **desktop application** (Tauri + local backend) with no requirement to run as a Cloudflare Worker.

## Target architecture (final desired state)

- **UI shell**: Tauri webview hosting the existing TanStack router app.
- **Backend runtime**: local Node/Bun process running the existing app server stack behind a platform shim.
- **Storage**:
  - Local SQLite/libsql database (or libsql remote mode) behind the same Drizzle schema.
  - Local filesystem media store (or local object emulator) behind the same storage interface.
- **Jobs/async work**:
  - Local job queue (initially in-process scheduler, later optional SQLite-backed queue).
  - Realtime updates over SSE in-process and local-safe route compatibility.
- **Auth/session**:
  - Better Auth + local env-backed session keys (`BETTER_AUTH_SECRET`) with local cookie/session strategy.
- **Deployment model**:
  - Signed desktop installers/executables from Tauri output.
  - Optional cloud sync later as an external service only (not initial requirement).

## Phase 1 - Full map + migration setup (completed)

**Goal:** produce a complete migration seam inventory and lock acceptance criteria before touching runtime behavior.

### Completed items

- Mapped platform-coupled modules and binding points:
  - `package.json` import-conditions for `#env`, `#db-client`, `#storage`.
  - `src/lib/db/client-d1.ts` + `src/lib/db/client-node.ts`.
  - `src/lib/env/cloudflare.ts` + `src/lib/env/default.ts`.
  - `src/lib/storage/storage-cloudflare.ts`, `src/lib/storage/storage-local.ts`, `src/lib/storage/storage-stub.ts`, `src/lib/storage/buckets.ts`, `src/lib/storage/upload-target.ts`.
  - `src/lib/workflow/client.ts`, `src/lib/workflow/trigger-bindings.ts`, `src/lib/workflow/types.ts`, `src/lib/workflow/await-child.ts`, `src/lib/workflows/*`.
  - `src/lib/realtime/index.ts`, `src/lib/realtime/realtime-channel.do.ts`, `src/routes/api/realtime.ts`.
  - `src/server.ts` re-exports and scheduled handler registration.
  - `wrangler.jsonc` bindings/workflows/durable objects/cron/schedules.
- Added dedicated migration namespace and governance continuity:
  - `docs/desktop-migration/desktop-migration-blueprint.md` (this file)
  - `tasks/TASK_INDEX.md`, `Audits_index.md`, `Repo_map.md`, `changelog.md`.
  - `tasks/0002-desktop-migration-blueprint-and-phase1-setup.md`.
  - `audits/2026-06-21-0002-desktop-migration-blueprint-audit.md`.
- Documented acceptance criteria and scope boundaries for phase transitions.

## Phase 2 - Platform adapters + local runtime (completed for this pass)

**Goal:** replace hard Cloudflare-only runtime assumptions with local-safe fallbacks while keeping existing API call signatures stable.

### Completed in this phase

- Workflow trigger dispatch:
  - `src/lib/workflow/client.ts` now supports local dispatch fallback IDs when bindings are unavailable.
- `src/lib/workflow/trigger-bindings.ts` now resolves optional workflow bindings and preserves strict behavior for production-required paths.
- `src/lib/runtime-mode.ts` now centralizes local-runtime detection for adapters.
- Realtime:
  - `src/lib/realtime/index.ts` now treats missing `REALTIME` as non-fatal in local runtime and returns no-op channels.
  - `src/routes/api/realtime.ts` now returns local SSE fallback stream with replay + heartbeats when Durable Object binding is unavailable and local mode is active.
  - `src/lib/realtime/local-channel.ts` tracks bounded history and active in-memory subscribers.
- Workflow reconciliation:
  - `src/lib/workflow/local-run-registry.ts` tracks local workflow run states (`queued`, `running`, `completed`, `failed`) for local adapters.
  - `src/lib/workflow/local-run-registry.ts` persists local workflow-run metadata to disk (`.openstory/local-workflow-runs.json`) so local restarts do not forget queued/running run IDs.
  - `src/lib/workflow/reconcile.ts` now checks local run metadata before hard-failing unresolved run IDs.
- Email service:
  - `src/lib/services/email-service.tsx` now simulates send with structured logging when `SEND_EMAIL` is absent and local mode is active.
- Server bootstrap:
  - `src/server.ts` now skips D1 seed self-bootstrap when `DB` is absent in local runtime mode instead of hard-failing.
- Env docs:
  - `.env.example` now documents local runtime switches and local DB/storage variables used by local adapters.
- Node/local runtime plumbing:
  - `package.json` import conditions now bind `#storage` to `src/lib/storage/storage-local.ts` by default.
  - `src/lib/db/client-node.ts` now creates local file-backed libSQL clients for local runtime.
- Runtime mode contract:
  - `src/lib/runtime-mode.ts` provides a single policy surface for local mode checks across all adapters.
- Verification:
  - Added local adapter test coverage in `src/lib/__tests__/runtime-mode.test.ts` and `src/lib/realtime/__tests__/local-channel.test.ts` for missing-binding startup and fallback behavior.

## Phase 3 - Desktop shell + packaging + cutover

**Goal:** run the product end-to-end as a Tauri desktop app and remove dependency on Workers in the local dev path.

- Create Tauri shell and wire to local server endpoint.
- Validate auth, uploads, generation workflows, and realtime updates in desktop shell.
- Add build/packaging configuration and release notes.
- Remove production-only assumptions in app boot path:
  - no `bun dev` Cloudflare service dependency in normal local desktop run.
- Add final migration evidence artifacts (smoke checklist, known limitations, and follow-up backlog).

## Phase 2/3 execution order for adapter completion

1. DB + env + storage foundation (`#db-client`, `#env`, `#storage`) [already partially present in repo local adapters].
2. local queue + job execution.
3. realtime + SSE replacement for non-DO mode.
4. startup/cron + background tasks.
5. UI/packaging validation.
