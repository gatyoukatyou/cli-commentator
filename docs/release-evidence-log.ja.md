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
- `release-desktop` run:
  - `v0.0.0-smoke.20260218-01` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22138523276`（Failure）
  - `v0.0.0-smoke.20260218-02` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22138744883`（Cancelled）
  - `v0.0.0-smoke.20260218-03` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22139085837`（Failure）
- Execution mode: unsigned-internal（Apple secrets missing）
- Artifact check:
  - `latest.json`: Missing（workflow failed before release creation）
  - `.app.tar.gz`: Present（`smoke.03` arm64/x64 buildで生成）
  - `.sig`: Present（`smoke.03` arm64/x64 buildで生成）
  - `.dmg`: Present（`smoke.03` arm64/x64 buildで生成）

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
- Accepted risk: Draft Release作成前に停止するため `latest.json` が未生成
- Blocking issue:
  - `#138` Apple certificate configuration（Apple secrets 未設定）
  - GitHub release create権限（`Resource not accessible by integration`）

### Follow-up
- [ ] `APPLE_*` secrets を整備し `pnpm verify:apple-signing` をPassさせる
- [x] x86向け runner 設定をサポート構成へ修正（`macos-15-intel`）し、`release-desktop` を再実行
- [ ] `Resource not accessible by integration` の権限要件を確認し、Draft Release作成を復旧する
- Owner: maintainers
- Due: 2026-02-19

## RC Evidence Record: 2026-02-18 (token fallback validation)

### Metadata
- Candidate: `v0.0.0-smoke.20260218-06` (workflow smoke rerun)
- Commit: `bde390b` (`fix/release-token-fallback-smoke-artifacts`)
- Reviewer: Codex
- Decision Meeting: `2026-02-18`
- Decision: Conditional Go（token fallback 経路のみ）

### CI Evidence
- Required checks run: PR #185 checks (`https://github.com/gatyoukatyou/cli-commentator/pull/185`)
- `publish-tauri`:
  - arm64: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141743350/job/64007523325`)
  - x64: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141743350/job/64007523482`)
- `desktop_distribution_smoke`: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141738456/job/64007505359`)
- `failure_regression`: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141738456/job/64007505332`)

### Release Workflow Evidence
- `release-desktop` run:
  - `v0.0.0-smoke.20260218-04` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141337857`（Failure）
  - `v0.0.0-smoke.20260218-05` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141678791`（Cancelled, superseded by smoke.06）
  - `v0.0.0-smoke.20260218-06` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22141743350`（Success）
- Execution mode: token fallback（`GH_RELEASE_TOKEN` 未設定）
- Artifact check:
  - `latest.json`: Missing（fallback modeではDraft Release未作成）
  - `smoke-bundle-aarch64-apple-darwin`: Present（artifact id `5556004921`）
  - `smoke-bundle-x86_64-apple-darwin`: Present（artifact id `5556019968`）
  - `.app.tar.gz` / `.sig` / `.dmg`: Present（両artifactに含有）

### Runtime/Recovery Evidence
- Desktop lifecycle event sample (`[desktop/server-event]`): `desktop_distribution_smoke` で runtime smoke を継続確認
- Server state event sample (`[server/state-event]`): `failure_regression` で state-event 系テストを継続確認
- Startup failure classification checked: Yes（既存 regression suite で継続確認）

### Cross-Platform Smoke Evidence
- macOS arm64: Pass（`smoke-bundle-aarch64-apple-darwin`）
- macOS x64: Pass（`smoke-bundle-x86_64-apple-darwin`）
- Windows fallback path: Pass（既存 `failure_regression` で継続）

### Risks and Exceptions
- Open P0/P1: None known at this record point
- Accepted risk: `GH_RELEASE_TOKEN` 未設定時は Draft Release を作成しない運用
- Blocking issue:
  - `#138` Apple certificate configuration（Apple secrets 未設定）
  - `GH_RELEASE_TOKEN` 未設定による release 作成不可

### Follow-up
- [ ] `GH_RELEASE_TOKEN`（`contents:write`）を設定し、Draft Release 作成フローへ戻す
- [ ] `APPLE_*` secrets を整備し `pnpm verify:apple-signing` をPassさせる
- [x] token fallback経路で smoke artifact 出力を検証（`smoke.06`）
- Owner: maintainers
- Due: 2026-02-19

## RC Evidence Record: 2026-02-20 (release permission preflight rollout)

### Metadata
- Candidate: `v0.0.0-smoke.20260219-test` (workflow smoke rerun)
- Commit: `559f781` (`fix/release-write-permission-preflight`)
- Reviewer: Codex
- Decision Meeting: `2026-02-20`
- Decision: Conditional Go（permission preflight + token fallback）

### CI Evidence
- Required checks run: PR #186 checks (`https://github.com/gatyoukatyou/cli-commentator/pull/186/checks`)
- `publish-tauri`:
  - arm64: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185152032/job/64156687334`)
  - x64: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185152032/job/64156687358`)
- `desktop_distribution_smoke`: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185057157/job/64156345943`)
- `failure_regression`: Pass (`https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185057157/job/64156345960`)

### Release Workflow Evidence
- `release-desktop` run:
  - `v0.0.0-smoke.20260219-test` → `https://github.com/gatyoukatyou/cli-commentator/actions/runs/22185152032`（Success）
- Execution mode: token fallback（`GH_RELEASE_TOKEN` 未設定）
- Release permission preflight:
  - `Verify release publish permissions`: Pass（arm64/x64 両job）
  - `Build and draft release (signed + notarized)` / `Build and draft release (unsigned internal)`: Skip（token fallback経路）
- Artifact check:
  - `latest.json`: Missing（fallback modeではDraft Release未作成）
  - `smoke-bundle-aarch64-apple-darwin`: Present（artifact id `5573817931`）
  - `smoke-bundle-x86_64-apple-darwin`: Present（artifact id `5573870598`）
  - `.app.tar.gz` / `.sig` / `.dmg`: Present（両artifactに含有）

### Runtime/Recovery Evidence
- Desktop lifecycle event sample (`[desktop/server-event]`): `desktop_distribution_smoke` で runtime smoke を継続確認
- Server state event sample (`[server/state-event]`): `failure_regression` で state-event 系テストを継続確認
- Startup failure classification checked: Yes（既存 regression suite で継続確認）

### Cross-Platform Smoke Evidence
- macOS arm64: Pass（`smoke-bundle-aarch64-apple-darwin`）
- macOS x64: Pass（`smoke-bundle-x86_64-apple-darwin`）
- Windows fallback path: Pass（`test_windows` check）

### Risks and Exceptions
- Open P0/P1: None known at this record point
- Accepted risk: `GH_RELEASE_TOKEN` 未設定時は Draft Release を作成しない運用
- Blocking issue:
  - `#138` Apple certificate configuration（repo secretsに `APPLE_CERTIFICATE` が未登録）
  - `GH_RELEASE_TOKEN` 未設定による release 作成不可

### Follow-up
- [x] release write権限 preflight を workflow に追加（PR #186, merge commit `60576eb`）
- [ ] `GH_RELEASE_TOKEN`（`contents:write`）を設定し、`Verify release publish permissions` の `write_capable=true` を確認する
- [ ] `APPLE_CERTIFICATE` を登録し、`pnpm verify:apple-signing` をPassさせる
- Owner: maintainers
- Due: 2026-02-23
