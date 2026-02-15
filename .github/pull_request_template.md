## Summary

<!-- Brief description of changes -->

## Related Issues

<!--
Use separate lines for auto-close:
Closes #123
Closes #456

NOT: Closes #123, #456 (comma won't work)

Note: Closing keywords only work for PRs targeting the default branch (main).
-->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactoring
- [ ] Documentation
- [ ] Other: <!-- describe -->

## Checklist

### General
- [ ] Tests pass locally (`pnpm -C apps/server test`)
- [ ] No new TypeScript errors
- [ ] Code follows existing patterns in the codebase

### LLM / Comment Changes
- [ ] Timeout handling verified (`COMMENT_TIMEOUT_MS` fallback works)
- [ ] Logs do NOT contain PII (no summary/prompt in logs)
- [ ] AbortSignal properly handled
- [ ] Error cases produce `comment_llm_error` logs

### Documentation
- [ ] CLAUDE.md updated if env vars or config changed
- [ ] ROADMAP/LLM_ADAPTER freshness reviewed (see `docs/docs-update-flow.ja.md`)
- [ ] If docs update was not needed, reason is written in Summary
- [ ] Inline comments added for non-obvious logic

### Desktop / Tauri (Sprint 28+)
- [ ] Desktop can start the server without requiring Node/pnpm on the target machine (bundled sidecar)
- [ ] Port collision handled (when 8787 is already in use, Desktop auto-falls back and still works)
- [ ] Desktop build passes (`pnpm -C apps/desktop tauri:build`)
- [ ] Bundled artifacts verified (sidecar node + server entry/resources included in the final bundle)

### Reviewer Focus
- [ ] Reviewed docs consistency for behavior/env/CI/release changes

## Test Plan

<!-- How can reviewers verify this change? -->

---
Generated with [Claude Code](https://claude.com/claude-code)
