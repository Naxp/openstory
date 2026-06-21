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
