<a href="release-evidence-log.ja.md"><kbd>日本語</kbd></a>
<a href="release-evidence-log.en.md"><kbd>English</kbd></a>

# v0.2.0 RC判定 証跡ログ

このドキュメントは `docs/release-evidence-template.ja.md` を使って蓄積する実運用ログです。  
新しい候補は末尾へ追記し、Go/No-Go の履歴を残します。

関連ドキュメント:
- 証跡テンプレート: `docs/release-evidence-template.ja.md`
- RC判定チェックリスト: `docs/release-rc-checklist.ja.md`
- Desktop Release Runbook: `docs/release-runbook.ja.md`

## RC Evidence Record: 2026-02-13

### Metadata
- Candidate: `v0.0.0-smoke.5` (internal dry-run)
- Commit: `main@2026-02-13`
- Reviewer: maintainers
- Decision Meeting: `2026-02-13`
- Decision: Conditional Go (internal verification only)

### CI Evidence
- Required checks run: `release-desktop` dry-run (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/21986062140`)
- `desktop_distribution_smoke`: Pass (同runの成果物検証)
- `failure_regression`: N/A (当時未導入)
- `failure_regression` summary artifact: N/A

### Release Workflow Evidence
- `release-desktop` run: `https://github.com/gatyoukatyou/cli-commentator/actions/runs/21986062140`
- Execution mode: unsigned-internal (Apple secrets missing)
- Artifact check:
  - `latest.json`: Present
  - `.app.tar.gz`: Present
  - `.sig`: Present
  - `.dmg`: Present

### Runtime/Recovery Evidence
- Desktop lifecycle event sample (`[desktop/server-event]`): N/A (workflow-level dry-run)
- Server state event sample (`[server/state-event]`): N/A (workflow-level dry-run)
- Startup failure classification checked: Yes (`docs/release-runbook.ja.md` 0.5章)

### Cross-Platform Smoke Evidence
- macOS arm64: Pass (workflow artifacts)
- macOS x64: Pass (workflow artifacts)
- Windows fallback path: Skip

### Risks and Exceptions
- Open P0/P1: None known at this record point
- Accepted risk: Apple signing secrets 未設定のため正式署名配布は未実施
- Blocking issue: `#138` Apple certificate configuration

### Follow-up
- [x] Apple signing secrets preflight validationをCIへ追加（PR #166）
- [x] RC判定証跡テンプレートを整備（PR #178）
- Owner: maintainers
- Due: 2026-02-17
