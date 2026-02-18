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

## RC Evidence Record: 2026-02-18

### Metadata
- Candidate: `preflight-2026-02-18` (local verification)
- Commit: `35262de` (`main`)
- Reviewer: Codex
- Decision Meeting: `2026-02-18`
- Decision: Conditional Go（local preflight only）

### CI Evidence
- Required checks run: local preflight (`pnpm verify:updater`, `pnpm -C apps/web lint`, `pnpm -C apps/web build`, `CLI_COMMENTATOR_FORCE_NO_PTY=1 pnpm -C apps/server test`)
- `desktop_distribution_smoke`: Pass（`pnpm smoke:desktop-distribution`, local）
- `failure_regression`: Pass（local vitest suite）
- `failure_regression` summary artifact: `artifacts/failure-regression/summary.md`（local workspace）

### Release Workflow Evidence
- `release-desktop` run: N/A（2026-02-18 は未実行）
- Execution mode: N/A
- Artifact check:
  - `latest.json`: N/A（workflow未実行）
  - `.app.tar.gz`: N/A（workflow未実行）
  - `.sig`: N/A（workflow未実行）
  - `.dmg`: N/A（workflow未実行）

### Runtime/Recovery Evidence
- Desktop lifecycle event sample (`[desktop/server-event]`): local `pnpm smoke:desktop-distribution` で `/healthz` + `comment_ok` を確認
- Server state event sample (`[server/state-event]`): local `failure_regression` で `state-event` テストを実行
- Startup failure classification checked: Yes（`src/tests/startup.failure.test.ts`）

### Cross-Platform Smoke Evidence
- macOS arm64: Pass（local `.app` runtime smoke）
- macOS x64: Skip（single-host local verification）
- Windows fallback path: Pass（`src/tests/windows-fallback-integration.test.ts` in local regression suite）

### Risks and Exceptions
- Open P0/P1: None known at this record point
- Accepted risk: signed `release-desktop` の証跡は未取得
- Blocking issue: `#138` Apple certificate configuration（Apple secrets 未設定）

### Follow-up
- [ ] `APPLE_*` secrets を整備し `pnpm verify:apple-signing` をPassさせる
- [ ] 新しい smoke tag で `release-desktop` を実行し、Actions URL付きで証跡を追記する
- Owner: maintainers
- Due: 2026-02-19
