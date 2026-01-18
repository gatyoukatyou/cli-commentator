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
- [ ] Inline comments added for non-obvious logic

## Test Plan

<!-- How can reviewers verify this change? -->

---
Generated with [Claude Code](https://claude.com/claude-code)
