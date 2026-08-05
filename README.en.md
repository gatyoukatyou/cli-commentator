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

## Local Use and Development

Start here first. Local startup and day-to-day readiness checks do not require signing, notarization, or updater distribution steps.

- Getting Started: `docs/getting-started.en.md`
- HUMAN User Testing Guide: `docs/human-user-test-guide.en.md`

## Distribution and Release Operations

Use these docs for release builds, signing, notarization, updater wiring, and draft release validation.

- Desktop Release Guide: `docs/desktop-release.en.md`
- Latest release: <https://github.com/gatyoukatyou/cli-commentator/releases/latest>

## Troubleshooting

- docs/getting-started.en.md#troubleshooting
