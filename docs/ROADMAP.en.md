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

**Now (next work)**
- Freeze requirements (Must/Should/Could) in docs/requirements.*
- Scaffold MVP apps (apps/server + apps/web) and make “commentary flows” work end-to-end

---

### Phase 3: Make it daily-usable (Should scope)
- Pluggable LLM adapters
- CLI profiles (cmd/cwd/env/tone)
- Crash/restart/reconnect robustness
- Stabilize Windows builds (node-pty mitigation plan)

---

### Phase 4: Distribution & always-on (Tauri, etc.)
- Desktop packaging, auto-launch, updates
- OS integration, signing, distribution

---

## Current status (as of 2026-01-11)
**Done**
- PR #1: detect boundary tests (mixed => generic, 50-line limit, exported constants)
- PR #2: add roadmap docs (JA/EN + links from docs/README)

**Next**
- P0: add detect lock boundary fixture (highest priority)
- P1: minimal CI via GitHub Actions

---

## Update rule (simple)
- Update “Done / Now / Next” every sprint
- If the direction changes (e.g., earlier Tauri), update phases accordingly
