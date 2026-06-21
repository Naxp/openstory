# OpenStory Desktop Migration Blueprint (Tauri-first, no Cloudflare runtime dependency)

Date: 2026-06-21

Scope: map and stand up the migration plan for converting runtime from Cloudflare Workers to a local desktop-first app while preserving the TanStack UI and domain model.

## Why this migration

Current app behavior is tightly coupled to Cloudflare primitives by design:
- `src/lib/db/client-d1.ts` + `wrangler.jsonc` D1 bindings
- `#env` and `cloudflare:workers` env accessors
- `#storage` Cloudflare R2 implementation
- `src/lib/workflow/*` CF Workflow bindings and trigger registry
- `src/lib/realtime/realtime-channel.do.ts` durable object realtime broker
- `src/server.ts` cron + seeded startup logic + exported CF workflow/DO classes

This blueprint sets a migration path to a **desktop application** (Tauri + local backend) with no requirement to run as a Cloudflare website or Cloudflare Worker.

## Target architecture (final desired state)

- **UI shell**: Tauri webview hosting the existing TanStack router app.
- **Backend runtime**: local Node/Bun process running the existing app server stack behind a platform shim.
- **Storage**:
  - Postgres/SQLite local file DB (or libsql) behind the same Drizzle schema.
  - Local filesystem media store (or local object emulator) behind the same storage interface.
- **Jobs/async work**:
  - Local job queue (initially in-process scheduler, later optional SQLite-backed queue).
  - Realtime updates over Server-Sent Events in-process.
- **Auth/session**:
  - Better Auth + local env-backed session keys (`BETTER_AUTH_SECRET`) with local cookie/session strategy.
- **Deployment model**:
  - Signed desktop installers/executables from Tauri output.
  - Optional optional cloud sync later as an external service only (not initial requirement).

## Phase 1 — Full map + migration setup (complete in this pass)

**Goal:** produce a complete migration seam inventory and lock acceptance criteria before touching runtime behavior.

### 1. Source-of-truth mapping (done now)
- Platform-seam modules and coupling points:
  - `package.json` import conditions for `#env`, `#db-client`, `#storage`.
  - `src/lib/db/client-d1.ts` + `src/lib/db/client-node.ts`.
  - `src/lib/env/cloudflare.ts` + `src/lib/env/default.ts`.
  - `src/lib/storage/storage-cloudflare.ts`, `src/lib/storage/storage-stub.ts`, `src/lib/storage/buckets.ts`, `src/lib/storage/upload-target.ts`.
  - `src/lib/workflow/client.ts`, `src/lib/workflow/trigger-bindings.ts`, `src/lib/workflow/types.ts`, `src/lib/workflow/await-child.ts`, `src/lib/workflows/*`.
  - `src/lib/realtime/realtime-channel.do.ts`, `src/routes/api/realtime.ts`.
  - `src/server.ts` re-exports and scheduled handler registration.
  - `wrangler.jsonc` bindings/workflows/durable objects/cron/schedules.
- Migration-risk zones:
  - Workflow orchestration and async fan-out
  - Multipart upload + storage routing
  - Cron/reconcile background sweeps
  - Realtime history and SSE connection lifecycle
  - Error/retry semantics around failure propagation

### 2. Workspace structure created
- Add a single migration namespace in-repo:
  - `docs/desktop-migration/desktop-migration-blueprint.md` (this file)
- Add pass tracking for this migration:
  - `tasks/0002-desktop-migration-blueprint-and-phase1-setup.md`
  - `audits/2026-06-21-0002-desktop-migration-blueprint-audit.md`
  - `Audits_index.md`, `tasks/TASK_INDEX.md`, `Repo_map.md`, `changelog.md` entries updated

### 3. Phase 1 acceptance criteria (must be met before Phase 2)
- Every platform-coupled file above has a designated replacement owner and target adapter.
- A migration decision matrix exists (keep, rewrite, remove) for each coupling.
- A local-only runtime adapter contract for env/db/storage/queue/realtime is documented.
- No feature behavior is changed in this pass (governance/doc-only only).

## Phase 2 — Platform adapters + local runtime (next)

**Goal:** replace Cloudflare-only runtime usage with local implementations while keeping API route contracts stable.

- Build explicit runtime adapters:
  - `#env` adapter for desktop startup/runtime env
  - `#db-client` adapter for local DB
  - `#storage` adapter for local object/media store
  - Workflow adapter for local async job queue
  - Realtime adapter for local SSE/DO replacement
- Provide compatibility shims so existing server functions keep same call signatures.
- Add local startup script path for desktop host (separate from Cloudflare scripts).

## Phase 3 — Desktop shell + packaging + cutover

**Goal:** run the product end-to-end as a Tauri desktop app and remove dependency on Workers in the local dev path.

- Create Tauri shell and wire to local server endpoint.
- Validate auth, uploads, generation workflows, and realtime updates in desktop shell.
- Add build/packaging configuration and release notes.
- Remove production-only assumptions in app boot path:
  - no `bun dev` Cloudflare service dependency in normal local desktop run
  - local config precedence for secrets/env values
- Add final migration evidence artifacts (smoke checklist + known limitations + follow-up backlog).

## Phase 2/3 implementation order within adapter changes (recommended)

1) DB + env + storage first (foundation),
2) local queue + job execution,
3) realtime + SSE compatibility,
4) startup/cron + background tasks,
5) UI/packaging validation.

## Immediate deliverables from this pass

- Phase 1 mapping doc completed
- Governance indices updated for migration task/audit/changelog/map continuity
- Concrete next phase with bounded scope and acceptance criteria ready for execution
