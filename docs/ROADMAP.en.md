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

### Phase 4: Distribution & always-on (Tauri, etc.)
- Desktop packaging, auto-launch, updates
- OS integration, signing, distribution
- Text-to-Speech (TTS)
- External monitoring mode (tmux / log file tail)

---

## Current status (as of 2026-02-07)
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

**Now**
- Phase 4 in progress (updater production config foundation + tag-based release automation)

**Next**
- Replace updater public key placeholder and run signed draft release from a real tag
- Expand release pipeline (notarization/code-signing and additional target platforms)

---

## Update rule (simple)
- Update “Done / Now / Next” every sprint
- If the direction changes (e.g., earlier Tauri), update phases accordingly
