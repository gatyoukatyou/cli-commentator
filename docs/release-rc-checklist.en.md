<a href="release-rc-checklist.ja.md"><kbd>日本語</kbd></a>
<a href="release-rc-checklist.en.md"><kbd>English</kbd></a>

# v0.2.0 RC Checklist

This document defines release-candidate decision criteria and logging format for `v0.2.0`.

Related docs:
- Decision evidence template: `docs/release-evidence-template.en.md`
- Desktop Release Runbook: `docs/release-runbook.en.md`

## 1) Go/No-Go Criteria

### A. Mandatory (any failure => No-Go)

- [ ] All required CI checks are green on `main`
- [ ] Desktop distribution minimum smoke (`desktop_distribution_smoke`) passes
- [ ] Updater verification (`pnpm verify:updater`) passes
- [ ] Core docs (Getting Started / Desktop Release / Runbook / ROADMAP) are synchronized
- [ ] No unresolved P0/P1 issues remain

### B. Recommended (conditional Go allowed)

- [ ] Signed artifact install smoke on macOS
- [ ] In-place updater flow validation from existing install
- [ ] Known limitations are documented for users

## 2) Minimum Procedure

1. Select candidate commit and tag (example: `v0.2.0-rc.1`)
2. Run `release-desktop` and record Actions URL
3. Verify artifacts exist (`latest.json`, `.app.tar.gz`, `.sig`, `.dmg`)
4. Evaluate mandatory section A and decide Go/No-Go
5. Record the result using `docs/release-evidence-template.en.md` (the template below is the minimum format)

## 3) Decision Record Template (Minimum)

In operation, prefer `docs/release-evidence-template.en.md`; use the block below as a compact fallback.

```md
## RC Record: YYYY-MM-DD
- Candidate: v0.2.0-rc.N
- Commit: <sha>
- Reviewer: <name>
- Actions Run: <url>
- Decision: Go / No-Go

### Mandatory Checks (A)
- CI all green: Pass/Fail
- desktop_distribution_smoke: Pass/Fail
- verify:updater: Pass/Fail
- docs sync: Pass/Fail
- open P0/P1: Pass/Fail

### Recommended Checks (B)
- signed install smoke: Pass/Fail/Skip
- updater upgrade smoke: Pass/Fail/Skip
- known limitations note: Pass/Fail

### Notes
- <risk / follow-up / blocker>
```

## 4) Trial Record (sample)

## RC Record: 2026-02-15
- Candidate: v0.2.0-rc.1 (dry-run)
- Commit: `main@2026-02-15`
- Reviewer: maintainers
- Actions Run: latest `release-desktop` dry-run
- Decision: Go (internal RC)

### Mandatory Checks (A)
- CI all green: Pass
- desktop_distribution_smoke: Pass
- verify:updater: Pass
- docs sync: Pass
- open P0/P1: Pass (Sprint 28 parent #141 closed)

### Recommended Checks (B)
- signed install smoke: Skip (`APPLE_CERTIFICATE` setup in progress)
- updater upgrade smoke: Pass (configuration path)
- known limitations note: Pass

### Notes
- `#138` (Apple certificate configuration) is still required before public signed distribution.
