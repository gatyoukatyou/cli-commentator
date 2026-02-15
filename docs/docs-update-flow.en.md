<a href="docs-update-flow.ja.md"><kbd>日本語</kbd></a>
<a href="docs-update-flow.en.md"><kbd>English</kbd></a>

# ROADMAP / LLM_ADAPTER Update Flow

## Purpose

Reduce stale documentation by keeping `docs/ROADMAP.*` and `docs/LLM_ADAPTER.ja.md` aligned with implementation changes.

## Target Documents

- `docs/ROADMAP.ja.md`
- `docs/ROADMAP.en.md`
- `docs/LLM_ADAPTER.ja.md`

## When to Evaluate Updates

For PRs matching any of the following, evaluate and document whether updates are required.

- Sprint start/finish changes, priorities, or `Now/Next` updates
- LLM provider, fallback behavior, env var, or contract changes
- Desktop distribution/CI gate changes that affect operational guidance

## Roles and Responsibilities

- PR author (required)
  - Decide which docs must be updated for the change
  - Include required doc updates in the same PR
  - If no update is needed, explain why in PR Summary
- Reviewer (required)
  - Verify implementation changes and docs remain consistent
  - Request fixes when updates are missing
- Merge operator (optional)
  - After squash merge, confirm ROADMAP still provides traceable context for issue/PR history

## PR Operation Rule

Use the Doc Freshness checklist in `.github/pull_request_template.md` and enforce:

- With updates: list updated doc paths in Summary
- Without updates: write the reason in Summary

## Minimum Review Focus

- ROADMAP `Current status` / `Now` / `Next` reflects the current day
- ROADMAP Japanese/English content remains synchronized
- LLM_ADAPTER provider list, env vars, and behavior still match implementation
- No implementation-impacting changes are merged without corresponding docs evaluation

## Operational Notes

- Do not defer doc updates to a later PR; include them with the implementation change.
- Re-check ROADMAP before closing sprint parent issues.

## CI Guard (Issue #132)

- On pull requests, `docs_drift_guard` runs `scripts/check-doc-sync.mjs`.
- If LLM/desktop-distribution implementation changes without matching docs updates, CI fails.
- Use `[skip-doc-sync-check]` in the PR body only for explicit exceptions, and include the reason.
