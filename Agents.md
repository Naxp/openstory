# OpenStory Agents Governance

## Purpose

This file is the canonical local AI/dev governance rulebook.

## Mandatory pre-read

Every AI/dev pass must start by reading:

- `Agents.md`
- relevant task files under `tasks/` when a task touches known systems
- relevant audit files under `audits/` for past context
- `Repo_map.md` sections covering impacted ownership
- source files before editing

## Pass type

All normal work is treated as a combined audit + implementation pass.

- Allowed exceptions:
  - audit-only
  - question-only
  - mapping-only
- For audit-only: no implementation edits.
- For question-only: no file edits.
- For mapping-only: update `Repo_map.md`, no feature edits unless explicitly requested.

## Task tracking

- The repo-level task index lives at `tasks/TASK_INDEX.md`.
- Every pass must update `tasks/TASK_INDEX.md` before implementation.
- Every task must have one dedicated task file in `tasks/`.
- Each task file must contain:
  - task name
  - date
  - goal
  - scope
  - checklist
  - files reviewed
  - files changed
  - audit reference
  - changelog reference
  - completion status

## Audit tracking

- Audit files live in `audits/`.
- Repo-level audit index: `Audits_index.md`.
- Every combined pass creates or updates an audit entry and adds it to `Audits_index.md`.
- Audit entries must include:
  - date
  - task reference
  - files reviewed
  - findings
  - risks
  - decisions
  - implementation notes (when applicable)
  - freshness status
- Audits older than 3 days are stale for implementation proof.
- If stale context is used, files must be re-checked before edits.

## Repo mapping

- Architecture and ownership changes are recorded in `Repo_map.md`.
- Mapping work belongs in `Repo_map.md`.
- If implementation affects architecture, file ownership, or source-of-truth relationships, update the map.

## Changelog

- Any file, code, config, documentation, or repo-structure change must include a `changelog.md` entry with:
  - date
  - task reference
  - summary
  - files changed
  - reason for change
- A pass is incomplete without `changelog.md` updated.

## Git behavior

- If the repo is Git-controlled:
  - stage only files changed in the pass
  - commit locally with a clear message
  - never push from this workflow
- If unrelated user changes exist in the working tree, do not overwrite them; stage only this pass’s changes.

## End-of-pass reporting

Every completed pass must include:

- Before
- After
- What changed
- Why
- Files reviewed
- Files changed
- Audit
- Task
- Changelog
- Git
  - commit hash/ID (or explicit reason not committed)
  - push status (must be `not pushed`)

## Repo-specific technical constraints and architecture

These existing repo-specific rules must be preserved from the legacy guidance:

- Stack: Bun launcher + Node runtime, TanStack Start + Router + Vite + Cloudflare Workers (Workerd/Miniflare local), Drizzle ORM + D1, Cloudflare Workflows, R2, Durable Objects, Better Auth, Tailwind v4, shadcn/ui.
- `bun dev` is the local bootstrap command and performs env setup, local D1 migration/seed, and server startup.
- Server handlers and workflow orchestration are implemented in `src/functions`, `src/lib`, `src/lib/workflows`, and route-based APIs in `src/routes/api`.
- DB schema changes are generated through migration workflows; avoid manual SQL edits in `drizzle/migrations`.
- Local safety conventions for bindings in `wrangler.jsonc` and D1 workflow must be respected.
- Use task/file naming conventions from existing code (`.tsx`/`.ts`, named exports, etc.).
- For the full architecture, command reference, and domain-specific coding rules, keep `CLAUDE.md` as the implementation source of truth.

## Existing instruction surfaces to preserve

- `CLAUDE.md` (legacy full governance and technical standards)
- `.claude/` (agent/hook instruction files)
- `.cursor/rules/` (editor rule surfaces)

Do not simplify or remove repo-specific details from these existing instructions unless they directly conflict with this standard. If a conflict is real and proven, preserve the stricter rule and add a clarification.

## Canonical locations

This repo’s canonical governance layout is:

- `Agents.md`
- `changelog.md`
- `Audits_index.md`
- `Repo_map.md`
- `audits/`
- `tasks/TASK_INDEX.md`
- `tasks/0001-update-agents-governance-standard.md`
