<a href="cross-platform-smoke-matrix.ja.md"><kbd>日本語</kbd></a>
<a href="cross-platform-smoke-matrix.en.md"><kbd>English</kbd></a>

# Cross-Platform Smoke Matrix

This document defines minimum cross-platform quality gates for distribution and operations.

## 1) Matrix Definition

| Platform | Target Artifact | Minimum Checks | Pass Criteria | Frequency | Owner |
|---|---|---|---|---|---|
| macOS arm64 | Desktop draft release artifact | Launch / UI render / server connect / one commentary cycle | Core flow completes without crash | Per RC | KURO |
| macOS x64 | Desktop draft release artifact | Launch / UI render / updater status visibility | App starts and updater status is shown | Per RC | KURO |
| Windows x64 | Desktop dev build (`cargo check/test`) | Build health / sidecar prep / startup path | CI `desktop_check` passes | Per PR | Codex |
| Linux x64 | Server + Web runtime | `pnpm dev` startup / web connection / commentary flow | `apps/server test` and `apps/web build` pass | Per PR | Codex |

## 2) Minimum Procedure

1. Record target PR/tag and commit SHA
2. Execute each matrix row and capture result
3. If any `Fail` occurs, open follow-up issue and mark `No-Go`
4. Release candidates require all mandatory rows to be `Pass`

## 3) Recording Template

```md
## Smoke Matrix Record: YYYY-MM-DD
- Target: <PR# or tag>
- Commit: <sha>
- Runner: <name>

| Platform | Result | Evidence |
|---|---|---|
| macOS arm64 | Pass/Fail/Skip | Actions URL or local notes |
| macOS x64 | Pass/Fail/Skip | Actions URL or local notes |
| Windows x64 | Pass/Fail/Skip | Actions URL or local notes |
| Linux x64 | Pass/Fail/Skip | Actions URL or local notes |

### Summary
- Go / No-Go
- Follow-up issues: #...
```

## 4) Current Practice (as of February 2026)

- Per PR:
  - validate `test`, `test_windows`, `desktop_check`, and `desktop_distribution_smoke`
- Per tag/RC:
  - reflect `release-desktop` outcomes in `docs/release-runbook.*` and RC records
- Note:
  - when Apple certs are unavailable, run unsigned internal mode separately from public release judgement
