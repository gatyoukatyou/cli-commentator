## Summary

<!-- Brief description of changes -->

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
- [ ] Inline comments added for non-obvious logic

## Test Plan

<!-- How can reviewers verify this change? -->

---
Generated with [Claude Code](https://claude.com/claude-code)
