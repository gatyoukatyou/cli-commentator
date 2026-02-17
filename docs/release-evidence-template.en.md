<a href="release-evidence-template.ja.md"><kbd>日本語</kbd></a>
<a href="release-evidence-template.en.md"><kbd>English</kbd></a>

# v0.2.0 RC Decision Evidence Template

This document defines a standard evidence format for `v0.2.0` RC decisions.  
During operation, copy this template and append records to a file like `docs/release-evidence-log.en.md`.

Related docs:
- RC checklist: `docs/release-rc-checklist.en.md`
- RC evidence log: `docs/release-evidence-log.en.md`
- Desktop Release Runbook: `docs/release-runbook.en.md`
- Cross-Platform Smoke Matrix: `docs/cross-platform-smoke-matrix.en.md`

## 1) How to use (minimum)

1. Copy one template block per RC candidate
2. Fill each field with real data (URL / commit / result)
3. Finalize Decision and Follow-up after the decision meeting
4. Add cross-links to the runbook audit trail

## 2) Record Template

```md
## RC Evidence Record: YYYY-MM-DD

### Metadata
- Candidate: `v0.2.0-rc.N`
- Commit: `<sha>`
- Reviewer: `<name>`
- Decision Meeting: `<date/time>`
- Decision: Go / No-Go / Conditional Go

### CI Evidence
- Required checks run: `<url>`
- `desktop_distribution_smoke`: Pass / Fail (`<url>`)
- `failure_regression`: Pass / Fail (`<url>`)
- `failure_regression` summary artifact: `<url or path>`

### Release Workflow Evidence
- `release-desktop` run: `<url>`
- Execution mode: signed / unsigned-internal
- Artifact check:
  - `latest.json`: Present / Missing
  - `.app.tar.gz`: Present / Missing
  - `.sig`: Present / Missing
  - `.dmg`: Present / Missing

### Runtime/Recovery Evidence
- Desktop lifecycle event sample (`[desktop/server-event]`): `<log snippet or path>`
- Server state event sample (`[server/state-event]`): `<log snippet or path>`
- Startup failure classification checked: Yes / No (`<reference>`)

### Cross-Platform Smoke Evidence
- macOS arm64: Pass / Fail / Skip (`<reference>`)
- macOS x64: Pass / Fail / Skip (`<reference>`)
- Windows fallback path: Pass / Fail / Skip (`<reference>`)

### Risks and Exceptions
- Open P0/P1: None / Present (`<issue list>`)
- Accepted risk: `<description or N/A>`
- Blocking issue: `<issue or N/A>`

### Follow-up
- [ ] `<action item #1>`
- [ ] `<action item #2>`
- Owner: `<name>`
- Due: `<date>`
```

## 3) Operation Notes

- Add one record per candidate and keep the history
- If URLs are private, always record a stable run ID
- For No-Go decisions, include comparison rationale against the next candidate in `Risks and Exceptions`
