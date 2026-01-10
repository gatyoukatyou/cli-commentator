<a href="requirements.ja.md"><kbd>日本語</kbd></a>
<a href="requirements.en.md"><kbd>English</kbd></a>

# Requirements (Must / Should / Could)

This project starts from an MVP: "wrap a target CLI with a PTY and stream beginner-friendly commentary in a separate window."

## Must (MVP)

- **PTY wrapper launch (macOS/Windows)**
  - The app spawns the target CLI under a PTY and captures I/O
- **Auto commentary (rule-based is fine)**
  - Convert raw logs into **events** first (read/search/test/error/git/github, etc.)
  - **Rate limit:** on event + at most once every 2 seconds
- **Separate-window UI**
  - Commentary flows in a separate view (doesn’t interrupt CLI usage)
- **Tone presets**
  - At least two (e.g., Standard / Kansai) + 1-line beginner hint + glossary notes in parentheses
- **Leak prevention (minimum)**
  - Mask secret-looking strings before sending/displaying (API keys / Bearer / long tokens)
- **Local-first (no API required)**
  - MVP works without an LLM (adapter comes later)

## Should (next)

- **Pluggable LLM adapter design** (OpenAI/Claude/Gemini)
- **CLI profiles** (cmd/args/cwd/env/tone)
- **Robust error handling** (PTY exit/crash/restart)
- **Stable Windows build plan** (node-pty native dependency mitigation)

## Could (future: external monitoring)

- **External monitor connectors**
  - tmux (pipe/capture)
  - tailing log files
  - PowerShell transcript, etc.
- **TTS**
  - Read commentary via a queue

## Non-functional (MVP baseline)

- Security: prefer “no leaks” even if over-masking; allowlist is a Should
- Platform: validate as local web first → Tauri later
