import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionLabService, isTerminalStatus } from '../core.js';

function reachApproval(lab: CompanionLabService) {
  let result = lab.start(0);
  assert.equal(result.accepted, true);
  for (let step = 0; step < 5; step += 1) {
    result = lab.advance(result.snapshot.generation);
    assert.equal(result.accepted, true, result.message);
  }
  return lab.snapshot();
}

test('scenario keeps both narrators tied to the same evidence and guards duplicate advances', () => {
  const lab = new CompanionLabService();
  const started = lab.start(0);
  assert.equal(started.code, 'started');
  assert.equal(started.snapshot.status, 'running');
  assert.equal(started.snapshot.phase, 'investigation');

  const duplicateStart = lab.start(0);
  assert.equal(duplicateStart.code, 'stale_generation');
  assert.equal(duplicateStart.snapshot.events.length, 1);

  let state = started.snapshot;
  const expectedPhases = ['change', 'test-failed', 'correction', 'test-passed', 'approval'] as const;
  for (const expectedPhase of expectedPhases) {
    const previousGeneration = state.generation;
    const advanced = lab.advance(previousGeneration);
    assert.equal(advanced.accepted, true);
    assert.equal(advanced.snapshot.phase, expectedPhase);
    assert.equal(advanced.snapshot.generation, previousGeneration + 1);

    const retry = lab.advance(previousGeneration);
    assert.equal(retry.accepted, false);
    assert.equal(retry.code, 'stale_generation');
    assert.equal(retry.snapshot.generation, advanced.snapshot.generation);
    assert.equal(retry.snapshot.phase, expectedPhase);
    state = advanced.snapshot;
  }

  for (const event of state.events) {
    assert.equal(event.dialogue.length, 2);
    assert.deepEqual(event.dialogue[0].evidenceIds, event.dialogue[1].evidenceIds);
    assert.deepEqual(event.dialogue[0].evidenceIds, event.evidence.map((evidence) => evidence.id));
  }
  assert.equal(state.status, 'awaiting-human');
  const blockedAdvance = lab.advance(state.generation);
  assert.equal(blockedAdvance.accepted, false);
  assert.equal(blockedAdvance.code, 'approval_required');
  assert.equal(blockedAdvance.snapshot.generation, state.generation);

  const held = lab.hold();
  assert.equal(held.accepted, true);
  assert.equal(held.snapshot.status, 'awaiting-human');
  assert.equal(held.snapshot.generation, state.generation);
});

test('human decisions reject stale and cross-session replies, then allow a fresh session', () => {
  const lab = new CompanionLabService();
  const waiting = reachApproval(lab);
  const approval = waiting.approval!;

  const wrongSession = lab.decideFromHuman({
    sessionId: 'another-session',
    approvalId: approval.approvalId,
    expectedGeneration: approval.expectedGeneration,
    decision: 'approve',
  });
  assert.equal(wrongSession.code, 'session_mismatch');
  const staleGeneration = lab.decideFromHuman({
    sessionId: approval.sessionId,
    approvalId: approval.approvalId,
    expectedGeneration: approval.expectedGeneration - 1,
    decision: 'approve',
  });
  assert.equal(staleGeneration.code, 'stale_approval');
  assert.equal(lab.snapshot().status, 'awaiting-human');

  const denied = lab.decideFromHuman({
    sessionId: approval.sessionId,
    approvalId: approval.approvalId,
    expectedGeneration: approval.expectedGeneration,
    decision: 'reject',
  });
  assert.equal(denied.code, 'rejected_in_demo');
  assert.equal(denied.snapshot.status, 'finished');
  assert.equal(denied.snapshot.phaseLabel, 'デモ終了');
  assert.match(lab.explain().summary, /デモ終了/);
  assert.match(lab.summarize().summary, /デモ終了/);
  assert.doesNotMatch(lab.explain().summary, /undefined|未開始/);

  const duplicateAnswer = lab.decideFromHuman({
    sessionId: approval.sessionId,
    approvalId: approval.approvalId,
    expectedGeneration: approval.expectedGeneration,
    decision: 'reject',
  });
  assert.equal(duplicateAnswer.code, 'stale_approval');

  const restarted = lab.start(denied.snapshot.generation);
  assert.equal(restarted.code, 'restarted');
  assert.notEqual(restarted.snapshot.sessionId, approval.sessionId);
  assert.equal(restarted.snapshot.approval, null);
  assert.equal(restarted.snapshot.generation, denied.snapshot.generation + 1);
  const oldAnswer = lab.decideFromHuman({
    sessionId: approval.sessionId,
    approvalId: approval.approvalId,
    expectedGeneration: approval.expectedGeneration,
    decision: 'approve',
  });
  assert.equal(oldAnswer.code, 'session_mismatch');
  assert.equal(lab.snapshot().phase, 'investigation');
});

test('approval can finish the demo without sharing and snapshots cannot mutate core state', () => {
  const lab = new CompanionLabService();
  const waiting = reachApproval(lab);
  const approval = waiting.approval!;
  const result = lab.decideFromHuman({
    sessionId: waiting.sessionId!,
    approvalId: approval.approvalId,
    expectedGeneration: waiting.generation,
    decision: 'approve',
  });
  assert.equal(result.accepted, true);
  assert.equal(result.snapshot.approval?.status, 'approve');
  assert.match(result.snapshot.changed, /実際の共有や外部操作は行っていません/);

  const externalSnapshot = lab.snapshot();
  externalSnapshot.events[0].evidence[0].statement = 'changed outside';
  externalSnapshot.events.push(externalSnapshot.events[0]);
  assert.notEqual(lab.snapshot().events[0].evidence[0].statement, 'changed outside');
  assert.equal(lab.snapshot().events.length, result.snapshot.events.length);
});

test('stop is distinct from unknown and is a terminal state with consistent explanations', () => {
  assert.equal(isTerminalStatus('unknown'), false);
  assert.equal(isTerminalStatus('finished'), true);
  assert.equal(isTerminalStatus('stopped'), true);

  const lab = new CompanionLabService();
  const stopped = lab.stop();
  assert.equal(stopped.snapshot.status, 'stopped');
  assert.equal(stopped.snapshot.phaseLabel, 'デモ停止');
  assert.match(lab.explain().summary, /デモ停止/);
  assert.match(lab.summarize().summary, /デモ停止/);
  assert.doesNotMatch(lab.summarize().summary, /undefined|未開始/);

  const advanceAfterStop = lab.advance(stopped.snapshot.generation);
  assert.equal(advanceAfterStop.code, 'terminal');
  assert.equal(advanceAfterStop.snapshot.generation, stopped.snapshot.generation);
});
