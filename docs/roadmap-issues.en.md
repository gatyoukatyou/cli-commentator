<a href="roadmap-issues.ja.md"><kbd>日本語</kbd></a>
<a href="roadmap-issues.en.md"><kbd>English</kbd></a>

# Roadmap Issue Drafts (Sprint 14-21)

## How to use
1. Copy each issue `Title` as-is
2. Paste each issue `Body`, then fill owner and due date
3. Suggested labels: `roadmap`, `sprint-14`, `area/release`

## Sprint 14 (2026-02-12 to 2026-02-25)

### 14-1
**Title**
`release: replace updater public key placeholder and add verification flow`

**Body**
```md
## Summary
Replace updater public key placeholder with real value and lock down the signature verification flow.

## Scope
- Implement a safe key replacement procedure
- Add verification steps to release runbook

## Tasks
- [ ] Implement key replacement procedure
- [ ] Add verification command flow
- [ ] Update docs

## Definition of Done
- Signature verification succeeds from a real tag release
- Recovery steps for failures are documented
```

### 14-2
**Title**
`ci: generate signed draft release from tag trigger`

**Body**
```md
## Summary
Create CI workflow that generates signed draft releases from tag pushes.

## Scope
- Add tag-triggered release workflow
- Attach signed artifacts to Draft Release

## Tasks
- [ ] Update release workflow
- [ ] Add signing/attach logic
- [ ] Add failure notification

## Definition of Done
- Draft Release is auto-created on tag push
- Signed artifacts are attached and verifiable
```

### 14-3
**Title**
`docs: release runbook v1 with recovery/rollback steps`

**Body**
```md
## Summary
Create release runbook v1 with standard path and recovery/rollback guidance.

## Scope
- Document happy-path release steps
- Document recovery and rollback for common failures

## Tasks
- [ ] Write happy-path flow
- [ ] Add failure recovery playbook
- [ ] Link from roadmap/docs index

## Definition of Done
- A new operator can run release using runbook only
- Rollback criteria are explicit
```

## Sprint 15 (2026-02-26 to 2026-03-11)

### 15-1
**Title**
`desktop: integrate macOS code-signing into CI workflow`

**Body**
```md
## Summary
Integrate macOS code-signing into CI to reduce manual release work.

## Scope
- CI-compatible signing setup
- Secret handling and failure logs

## Tasks
- [ ] Add signing config to CI
- [ ] Add secrets validation
- [ ] Improve signing failure logs

## Definition of Done
- Signed macOS artifacts are generated continuously in CI
- Signing failures are diagnosable from logs
```

### 15-2
**Title**
`desktop: automate notarization submit/staple`

**Body**
```md
## Summary
Automate notarization submit/staple flow for reliable pre-distribution operation.

## Scope
- Automate submit/staple pipeline
- Add operation logs for traceability

## Tasks
- [ ] Automate submit step
- [ ] Automate staple step
- [ ] Document retry steps for failures

## Definition of Done
- Notarization runs end-to-end after signing
- Results are trackable in CI logs
```

### 15-3
**Title**
`docs: define certificate/secrets operations guide`

**Body**
```md
## Summary
Document certificate and secrets lifecycle operations (create/update/revoke).

## Scope
- Certificate lifecycle operations
- Secret rotation and audit requirements

## Tasks
- [ ] Document update/rotation flow
- [ ] Define permission model
- [ ] Add audit checklist

## Definition of Done
- Certificate updates follow standardized process
- Secret access can be operated without ambiguity
```

## Sprint 16 (2026-03-12 to 2026-03-25)

### 16-1
**Title**
`qa: add clean-environment smoke tests for desktop artifacts`

**Body**
```md
## Summary
Add smoke tests for install-to-first-launch flow in clean environments.

## Scope
- Install distributed artifact
- Verify first launch and commentary start

## Tasks
- [ ] Define smoke scenarios
- [ ] Run on representative environments
- [ ] Record failure patterns

## Definition of Done
- install -> launch -> commentary start is reproducible
- Failure conditions are documented
```

### 16-2
**Title**
`desktop: improve startup failure recovery guidance in panel UI`

**Body**
```md
## Summary
Improve desktop panel guidance so users can recover from startup failures quickly.

## Scope
- Classify startup failures in UI
- Show immediate recovery actions

## Tasks
- [ ] Classify error messages
- [ ] Update recovery hints
- [ ] Add regression checks for panel output

## Definition of Done
- Major startup failures show actionable recovery guidance
- Users can determine next action from UI
```

### 16-3
**Title**
`server: strengthen startup-failure classification logs`

**Body**
```md
## Summary
Improve startup-failure logs with explicit categories and recovery context.

## Scope
- Add failure categories
- Add context needed for fast triage

## Tasks
- [ ] Design log fields
- [ ] Implement classification logic
- [ ] Add tests

## Definition of Done
- Major startup failures are diagnosable from logs
- Existing log compatibility is preserved
```

## Sprint 17 (2026-03-26 to 2026-04-08)

### 17-1
**Title**
`server: add structured state-transition logging`

**Body**
```md
## Summary
Introduce structured state-transition logging for timeline-level incident analysis.

## Scope
- Standardize transition event schema
- Emit logs compatible with collectors

## Tasks
- [ ] Define event schema
- [ ] Update emitters
- [ ] Add tests/examples

## Definition of Done
- State transitions can be traced as timeline
- Logs can be ingested by expected tooling
```

### 17-2
**Title**
`test: extend node-pty unavailable fallback E2E coverage`

**Body**
```md
## Summary
Extend E2E coverage for node-pty unavailable fallback paths.

## Scope
- Startup fallback path
- Restart fallback path

## Tasks
- [ ] Add E2E scenarios
- [ ] Validate contract messages
- [ ] Lock regression cases

## Definition of Done
- Core fallback scenarios are auto-tested
- `ptyUnavailable` contract regressions are detected
```

### 17-3
**Title**
`ci: add regression job for failure scenarios`

**Body**
```md
## Summary
Add dedicated CI regression job for known failure scenarios.

## Scope
- Run failure-focused suite on PRs
- Emit useful triage logs on failures

## Tasks
- [ ] Add CI job
- [ ] Select target tests
- [ ] Improve result visibility

## Definition of Done
- Failure regressions are caught in PR checks
- Debug information is available on failures
```

## Sprint 18 (2026-04-09 to 2026-04-22)

### 18-1
**Title**
`rulesets: add mis-detection cases and tune detect thresholds`

**Body**
```md
## Summary
Add mis-detection fixtures and tune detect thresholds to improve classification accuracy.

## Scope
- Add problematic log fixtures
- Tune rules/threshold behavior

## Tasks
- [ ] Add fixtures
- [ ] Adjust detection logic
- [ ] Update regression tests

## Definition of Done
- Mis-detection rate improves on representative logs
- Existing successful cases stay green
```

### 18-2
**Title**
`styles: improve one-line beginner explanation templates`

**Body**
```md
## Summary
Improve one-line beginner explanation templates for clearer commentary output.

## Scope
- Update templates by style tone
- Improve glossary-note behavior

## Tasks
- [ ] Draft template candidates
- [ ] Evaluate on real logs
- [ ] Implement selected updates

## Definition of Done
- Readability improves on representative scenarios
- Style differences remain intact
```

### 18-3
**Title**
`test: expand commentary quality fixtures and snapshots`

**Body**
```md
## Summary
Expand fixtures/snapshots to guard commentary quality against regressions.

## Scope
- Add quality-focused fixtures
- Refine snapshot coverage

## Tasks
- [ ] Add fixtures
- [ ] Update snapshots
- [ ] Review expected outputs

## Definition of Done
- Quality regressions are detected by tests
- Snapshot intent is understandable
```

## Sprint 19 (2026-04-23 to 2026-05-06)

### 19-1
**Title**
`web: improve glossary-note presentation for readability`

**Body**
```md
## Summary
Improve glossary-note presentation so beginner users can read commentary more easily.

## Scope
- Update note layout
- Improve visual readability

## Tasks
- [ ] Document current pain points
- [ ] Implement UI changes
- [ ] Verify on key screens

## Definition of Done
- Notes are readable without breaking main text flow
- Works on desktop and mobile layouts
```

### 19-2
**Title**
`web: add minimal filter/search for commentary logs`

**Body**
```md
## Summary
Add minimal filter/search features to improve long-session log navigation.

## Scope
- Keyword search
- Minimal filtering (for example by event type)

## Tasks
- [ ] Implement UI/state logic
- [ ] Validate performance on larger logs
- [ ] Add regression tests

## Definition of Done
- Feature remains usable on ~200 log items
- Existing log view behavior is preserved
```

### 19-3
**Title**
`tts: tune voice setting presets`

**Body**
```md
## Summary
Tune TTS presets to improve default listening quality for first-time users.

## Scope
- Adjust speed/pitch/volume presets
- Verify behavior across major browsers

## Tasks
- [ ] Draft new presets
- [ ] Run manual verification
- [ ] Update defaults

## Definition of Done
- Default preset is broadly understandable
- Settings UI and defaults stay consistent
```

## Sprint 20 (2026-05-07 to 2026-05-20)

### 20-1
**Title**
`ci: add docs-vs-implementation drift checks`

**Body**
```md
## Summary
Add PR-time checks to detect drift between major docs and implementation.

## Scope
- Define target docs and drift rules
- Add automated CI checks

## Tasks
- [ ] Define drift rules
- [ ] Add CI job
- [ ] Improve failure messages

## Definition of Done
- Major drifts are detected in PR checks
- False positives remain acceptable
```

### 20-2
**Title**
`docs: standardize ROADMAP/LLM_ADAPTER update workflow`

**Body**
```md
## Summary
Standardize update workflow for ROADMAP/LLM_ADAPTER to reduce stale docs.

## Scope
- Define update timing and ownership
- Reflect checks in PR workflow

## Tasks
- [ ] Document workflow
- [ ] Update PR template
- [ ] Add review checklist items

## Definition of Done
- Team follows shared update process
- Doc freshness improves in regular operation
```

### 20-3
**Title**
`ai: add checklist templates for session logs and education reports`

**Body**
```md
## Summary
Add checklists for AI session logs and education reports to reduce handoff gaps.

## Scope
- Session-end checklist
- Report-quality checklist

## Tasks
- [ ] Create checklist templates
- [ ] Integrate into operating docs
- [ ] Add sample usage

## Definition of Done
- Handoff omissions are reduced
- Report quality becomes more consistent
```

## Sprint 21 (2026-05-21 to 2026-06-03)

### 21-1
**Title**
`release: create and run v0.2.0 RC checklist`

**Body**
```md
## Summary
Create and operate the v0.2.0 RC checklist with clear go/no-go criteria.

## Scope
- Define RC gate criteria
- Define evidence recording format

## Tasks
- [ ] Create checklist
- [ ] Run trial operation
- [ ] Apply missing updates

## Definition of Done
- Go/No-Go criteria are explicit
- Decision evidence can be traced
```

### 21-2
**Title**
`qa: establish cross-platform smoke test matrix`

**Body**
```md
## Summary
Establish a sustainable cross-platform smoke-test matrix for key release paths.

## Scope
- Define OS/artifact/verification matrix
- Define execution cadence and ownership

## Tasks
- [ ] Create matrix
- [ ] Document run procedure
- [ ] Standardize result format

## Definition of Done
- Minimum quality bar is clear by platform
- Matrix operation is repeatable
```

### 21-3
**Title**
`docs: finalize getting-started and distribution path updates`

**Body**
```md
## Summary
Finalize getting-started and distribution path docs for v0.2.0 readiness.

## Scope
- Update onboarding steps
- Refresh distribution links and guidance

## Tasks
- [ ] Update getting-started docs
- [ ] Update distribution path docs
- [ ] Verify JA/EN consistency

## Definition of Done
- New users can onboard without confusion
- No broken cross-doc links remain
```
