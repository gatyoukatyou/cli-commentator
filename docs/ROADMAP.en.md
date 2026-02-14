<a href="ROADMAP.ja.md"><kbd>日本語</kbd></a>
<a href="ROADMAP.en.md"><kbd>English</kbd></a>

# CLI Commentator Roadmap (v1)

## What is this?
CLI Commentator is an app that reads terminal work logs and streams beginner-friendly commentary in a separate window.  
This page summarizes the **Goal**, the **phases**, and the **current status** in a simple, non-technical way.

---

## Goal
- Use your terminal as usual (Claude Code / Codex / bash / git, etc.)
- The app reads logs and generates “what’s happening now?” commentary automatically
- Commentary flows in a **separate window** (doesn’t interrupt work)
- Tone presets (Standard / Kansai, etc.) + 1-line beginner hint + glossary notes (parentheses)
- Mask secret-looking strings to reduce leakage risk
- MVP works without an LLM (rule-based), with an option to add LLM adapters later

---

## Principle
We prioritize a **stable foundation** over flashy features.  
Build a minimal MVP that reliably works, then expand once value is proven.

---

## Phases

### Phase 0: Documentation & operating basics
**Done**
- Split README into EN/JA and add a landing README.md
- Add docs bilingual policy (docs/README.*)

---

### Phase 1: Stabilize the core (detect)
**Done**
- PR #1: Harden detect boundary behavior with tests (mixed logs => generic, 50-line limit, exported constants)

---

### Phase 2: Connect the MVP (show value quickly)
- PTY-wrapped launch (or log ingestion)
- Event extraction → commentary → separate window UI
- Rate limit (max once per 2s), minimal redaction, tone presets

**Done**
- Freeze requirements (Must/Should/Could) in docs/requirements.*
- MVP implementation complete (apps/server + apps/web working end-to-end)
- Add detect lock boundary fixture
- Minimal CI via GitHub Actions

---

### Phase 3: Make it daily-usable (Should scope)

**Done**
- Operational Resilience
  - Server exit cleanup (terminal protection)
  - Web WebSocket reconnection
- LLM Adapter design (Sprint 5-9)
  - OpenAI / Groq / Local / Gemini / Anthropic providers
  - Timeout protection with AbortController
  - Smoke tests & contract tests
- CLI profiles (Sprint 11)
  - Profile CRUD operations
  - WebSocket-based profile management
  - PTY restart on profile switch (Sprint 13)
- Windows build stabilization (node-pty unavailable contract + automatic fallback)

---

### Phase 4: Distribution & always-on (Tauri, etc.) [In progress]
- Desktop packaging, auto-launch, updates
- OS integration, signing, distribution
- Text-to-Speech (TTS)
- External monitoring mode (tmux / log file tail)

**In progress**
- Tauri managed lifecycle (start/stop/status/recovery) is already in operation
- Sprint 28 execution started with parent/child issues #141-#146 (docs sync, sidecar packaging path, port-collision handling, CI guard)

---

## Current status (as of 2026-02-14)
**Done**
- PR #1: detect boundary tests (mixed => generic, 50-line limit, exported constants)
- PR #2: add roadmap docs (JA/EN + links from docs/README)
- PR #4: detect lock boundary fixture + CI
- MVP implementation complete (apps/server + apps/web working)
- PR #6: Sprint 4 Operational Resilience
- PR #7-9: LLM Adapter foundation (factory + mock + comment integration)
- Sprint 10: LLM Providers (OpenAI / Groq / Local / Gemini)
- PR #19: Anthropic provider
- PR #20-21: LLM smoke tests + contract tests
- PR #22: CLI profile management
- Sprint 13: PTY restart on profile switch
- PR #94: PTY unavailable UX + WS contract alignment + ConPTY resolver tests + web lint CI
- PR #95-96: lock `ptyUnavailable` contract for node-pty failures (restart path + integration-like test)
- PR #97: Tauri managed startup lifecycle (idempotent start/stop, failed-state visibility)
- PR #98: lock Tauri lifecycle contract with tests + desktop CI (cargo check/test)
- PR #99: Desktop Server operational panel (state/recovery guidance) + auto-start toggle
- PR #100: desktop distribution foundation (autostart controls + release checklist docs)
- PR #101: updater check command + desktop panel status/action
- PR #102: updater config baseline + tag-based desktop release workflow
- Added 3AI operations foundation (`AGENTS.md` / `GEMINI.md` / `/wrapup` session hook)
- 2026-02-13: ran `release-desktop` dry-run with `v0.0.0-smoke.5`; updater key-pair validation passed and Apple-secret gate was identified
- 2026-02-14: created Sprint 28 tracking issues (#141 parent, #142-#146 children) for docs sync + desktop sidecar distribution path

**Now**
- Execute Sprint 28 in dependency order (`28-01` -> `28-02` -> `28-03` -> `28-04` -> `28-05`)
- Start with docs sync (#142): Desktop operation, input modes (`pty|file`), Windows constraints, and `.env.example` alignment
- Keep release-desktop dry-run findings visible while implementation shifts to sidecar packaging foundation

**Next**
- #143: finalize bundled server artifact generation (build + placement)
- #144: switch Tauri server startup to bundled artifacts (remove dev-time `pnpm` dependency from runtime path)
- #145: implement port collision fallback and make UI/WS follow actual port
- #146: add minimum CI guard for desktop build + bundled artifact presence

---

## Biweekly Sprint Plan (Issue Breakdown Draft)

### Sprint 14 (2026-02-12 to 2026-02-25): Updater productionization
**Issue drafts**
- `release: replace updater public key placeholder and add verification flow`
- `ci: generate signed draft release from tag trigger`
- `docs: release runbook v1 with recovery/rollback steps`

**Definition of done**
- Update flow is reproducible from a real tag
- Recovery steps are documented for failed release attempts

### Sprint 15 (2026-02-26 to 2026-03-11): Notarization/signing baseline
**Issue drafts**
- `desktop: integrate macOS code-signing into CI workflow`
- `desktop: automate notarization submit/staple`
- `docs: define certificate/secrets operations guide`

**Definition of done**
- Signed artifacts are generated continuously
- Certificate rotation/maintenance procedure is documented

### Sprint 16 (2026-03-12 to 2026-03-25): Distribution reliability & startup recovery
**Issue drafts**
- `qa: add clean-environment smoke tests for desktop artifacts`
- `desktop: improve startup failure recovery guidance in panel UI`
- `server: strengthen startup-failure classification logs`

**Definition of done**
- Clean environment can complete install -> launch -> commentary start
- Major startup failures can be triaged quickly

### Sprint 17 (2026-03-26 to 2026-04-08): Observability & fallback hardening
**Issue drafts**
- `server: add structured state-transition logging`
- `test: extend node-pty unavailable fallback E2E coverage`
- `ci: add regression job for failure scenarios`

**Definition of done**
- Failures can be traced with timeline-level evidence
- Fallback behavior is protected against regressions

### Sprint 18 (2026-04-09 to 2026-04-22): Commentary quality iteration 1
**Issue drafts**
- `rulesets: add mis-detection cases and tune detect thresholds`
- `styles: improve one-line beginner explanation templates`
- `test: expand commentary quality fixtures and snapshots`

**Definition of done**
- Mis-detection rate improves on representative scenarios
- Commentary readability metrics improve

### Sprint 19 (2026-04-23 to 2026-05-06): Commentary quality iteration 2 / UX
**Issue drafts**
- `web: improve glossary-note presentation for readability`
- `web: add minimal filter/search for commentary logs`
- `tts: tune voice setting presets`

**Definition of done**
- Beginner users can follow commentary more easily
- Long-session readability is improved

### Sprint 20 (2026-05-07 to 2026-05-20): Operations automation
**Issue drafts**
- `ci: add docs-vs-implementation drift checks`
- `docs: standardize ROADMAP/LLM_ADAPTER update workflow`
- `ai: add checklist templates for session logs and education reports`

**Definition of done**
- Major doc staleness is detected during PR validation
- AI handoff/reporting misses are reduced

### Sprint 21 (2026-05-21 to 2026-06-03): v0.2.0 release readiness
**Issue drafts**
- `release: create and run v0.2.0 RC checklist`
- `qa: establish cross-platform smoke test matrix`
- `docs: finalize getting-started and distribution path updates`

**Definition of done**
- Clear go/no-go criteria exist for v0.2.0 RC
- Distribution -> first launch user path is clear and validated

---

## Update rule (simple)
- Update “Done / Now / Next” every sprint
- If the direction changes (e.g., earlier Tauri), update phases accordingly
