<a href="README.ja.md"><kbd>日本語</kbd></a>
<a href="README.en.md"><kbd>English</kbd></a>

# cli-commentator

MVP for streaming CLI commentary in a separate window.

## Overview

This repository is the starting point for a tool that wraps a CLI with a PTY, classifies events, and streams commentary to a separate UI window. The MVP begins with local, rule-based commentary and evolves into pluggable LLM adapters.

## Documentation Language Policy

Public documentation is maintained in both Japanese and English.

- `README.ja.md` and `README.en.md` are the canonical project readmes.
- Future docs go in `docs/<topic>.ja.md` and `docs/<topic>.en.md`.
- Each paired document starts with language switch links.

## Target CLI Examples

Set `TARGET_CMD` in `apps/server/.env`. Examples: `/bin/bash`, `/bin/zsh`, `powershell`, `claude`, `codex`
