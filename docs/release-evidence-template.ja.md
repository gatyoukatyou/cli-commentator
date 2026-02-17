<a href="release-evidence-template.ja.md"><kbd>日本語</kbd></a>
<a href="release-evidence-template.en.md"><kbd>English</kbd></a>

# v0.2.0 RC判定 証跡テンプレート

このドキュメントは、`v0.2.0` RC判定時に残す証跡を同じ形式で記録するための雛形です。  
運用時はこのテンプレートをコピーして `docs/release-evidence-log.ja.md` などへ追記してください。

関連ドキュメント:
- RC判定チェックリスト: `docs/release-rc-checklist.ja.md`
- Desktop Release Runbook: `docs/release-runbook.ja.md`
- Cross-Platform Smoke Matrix: `docs/cross-platform-smoke-matrix.ja.md`

## 1) 使い方（最小）

1. RC候補ごとにこのテンプレートを1ブロックコピーする
2. 各項目に実データ（URL / commit / 結果）を記入する
3. 判定会議後、DecisionとFollow-upを確定する
4. Runbook監査ログと相互リンクを貼る

## 2) 記録テンプレート

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

## 3) 運用メモ

- 1候補につき1レコードを追加し、履歴を残す
- URLが社内限定の場合は `run id` を必ず記録する
- No-Go時は次候補との比較理由を `Risks and Exceptions` に追記する
