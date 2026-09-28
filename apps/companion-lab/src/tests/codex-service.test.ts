import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApprovalRecord, CodexDecision } from '../core.js';
import {
  CodexAppServerClient,
  type CodexApprovalRequest,
  type CodexClientObserver,
  type CodexObservation,
} from '../codex-client.js';
import { CodexCompanionLabService } from '../codex-service.js';

const THREAD_ID = 'thread-current';
const TURN_ID = 'turn-current';

class StubCodexClient extends CodexAppServerClient {
  readonly observers = new Map<string, CodexClientObserver>();
  readonly startedSessions: string[] = [];
  readonly decisions: Array<{ sessionId: string; approvalId: string; decision: CodexDecision }> = [];
  readonly stopSessions: string[] = [];
  respondAccepted = true;
  stopAccepted = true;

  constructor() {
    super({ binary: process.execPath, model: 'test-model', reasoningEffort: 'low' });
  }

  override start(sessionId: string, observer: CodexClientObserver): void {
    this.startedSessions.push(sessionId);
    this.observers.set(sessionId, observer);
  }

  emit(sessionId: string, observation: CodexObservation): void {
    this.observers.get(sessionId)?.onObservation(sessionId, observation);
  }

  requestApproval(sessionId: string, approval: CodexApprovalRequest): void {
    this.observers.get(sessionId)?.onApproval(sessionId, approval);
  }

  override respond(sessionId: string, approvalId: string, decision: CodexDecision): boolean {
    if (!this.respondAccepted) return false;
    this.decisions.push({ sessionId, approvalId, decision });
    this.emit(sessionId, { type: 'approval-response-sent', approvalId, decision });
    return true;
  }

  override stop(sessionId: string): boolean {
    this.stopSessions.push(sessionId);
    return this.stopAccepted;
  }

  override async close(): Promise<void> {}
}

function makeService() {
  const client = new StubCodexClient();
  const service = new CodexCompanionLabService(client);
  return { client, service };
}

function startService(client: StubCodexClient, service: CodexCompanionLabService): string {
  const result = service.start(0);
  assert.equal(result.accepted, true);
  assert.equal(result.code, 'started');
  const sessionId = service.snapshot().sessionId;
  assert.ok(sessionId);
  assert.deepEqual(client.startedSessions, [sessionId]);
  return sessionId;
}

function makeActiveService() {
  const { client, service } = makeService();
  const sessionId = startService(client, service);
  client.emit(sessionId, { type: 'child-status', status: 'running' });
  client.emit(sessionId, { type: 'thread-started', threadId: THREAD_ID, model: 'test-model', reasoningEffort: 'low' });
  client.emit(sessionId, { type: 'turn-started', threadId: THREAD_ID, turnId: TURN_ID });
  assert.equal(service.snapshot().status, 'running');
  return { client, service, sessionId };
}

function approvalRequest(overrides: Partial<CodexApprovalRequest> = {}): CodexApprovalRequest {
  return {
    approvalId: 'approval-current',
    requestId: 'rpc-approval-current',
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: 'item-command-current',
    title: 'コマンド実行の確認',
    preview: '種類: command\nコマンド: cat sample.txt\n作業場所: /tmp/companion-sample',
    reason: 'Codexが一回限りのコマンド承認を求めました。',
    canAccept: true,
    blockedReason: null,
    ...overrides,
  };
}

function humanDecision(service: CodexCompanionLabService, sessionId: string, approval: ApprovalRecord, decision: 'approve' | 'reject' = 'approve') {
  return service.decideFromHuman({
    sessionId,
    approvalId: approval.approvalId,
    expectedGeneration: approval.expectedGeneration,
    decision,
  });
}

test('start requires the current generation and permits one start while active', () => {
  const { client, service } = makeService();

  const stale = service.start(1);
  assert.equal(stale.accepted, false);
  assert.equal(stale.code, 'stale_generation');
  assert.equal(client.startedSessions.length, 0);

  const started = service.start(0);
  assert.equal(started.accepted, true);
  assert.equal(service.snapshot().generation, 1);
  const activeStart = service.start(service.snapshot().generation);
  assert.equal(activeStart.accepted, false);
  assert.equal(activeStart.code, 'already_started');
  assert.equal(client.startedSessions.length, 1);
});

test('command completion, failure, and decline do not finish the Codex turn', () => {
  for (const outcome of [
    { status: 'completed' as const, exitCode: 0, text: 'status=completed' },
    { status: 'failed' as const, exitCode: 1, text: 'status=failed' },
    { status: 'declined' as const, exitCode: null, text: 'status=declined' },
  ]) {
    const { client, service, sessionId } = makeActiveService();
    client.emit(sessionId, {
      type: 'command-completed',
      threadId: THREAD_ID,
      turnId: TURN_ID,
      itemId: 'item-command-current',
      status: outcome.status,
      exitCode: outcome.exitCode,
    });

    const snapshot = service.snapshot();
    assert.equal(snapshot.status, 'running');
    assert.equal(snapshot.phase, 'codex-running');
    assert.equal(snapshot.codex?.turnStatus, 'inProgress');
    assert.match(snapshot.events.at(-1)?.evidence[0]?.statement ?? '', new RegExp(outcome.text));
    assert.notEqual(snapshot.phase, 'finished');
  }
});

test('turn completion stays distinct from a still-running child and AI report is unverified', () => {
  const { client, service, sessionId } = makeActiveService();
  const report = 'sample.txt says the office opens at 9.';
  client.emit(sessionId, {
    type: 'agent-message-completed',
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: 'item-agent-final',
    text: report,
    finalAnswer: true,
  });
  assert.equal(service.snapshot().codex?.finalReport, report);
  assert.match(service.snapshot().events.at(-1)?.evidence[0]?.statement ?? '', /独立検証ではありません/);

  client.emit(sessionId, { type: 'turn-completed', threadId: THREAD_ID, turnId: TURN_ID, status: 'completed' });
  const snapshot = service.snapshot();
  assert.equal(snapshot.status, 'finished');
  assert.equal(snapshot.codex?.turnStatus, 'completed');
  assert.equal(snapshot.phase, 'finished');
  assert.equal(snapshot.codex?.childStatus, 'running');
  assert.match(snapshot.events.at(-1)?.evidence[0]?.statement ?? '', /turn .* が completed で完了しました/);
  assert.match(snapshot.decision, /正しさ.*別途確認/);
  assert.equal(snapshot.codex?.finalReport, report);
});

test('stopping the connection after a completed turn updates phase and decision when the child closes', () => {
  const { client, service, sessionId } = makeActiveService();
  client.emit(sessionId, { type: 'turn-completed', threadId: THREAD_ID, turnId: TURN_ID, status: 'completed' });
  assert.equal(service.snapshot().status, 'finished');
  assert.equal(service.snapshot().phase, 'finished');
  assert.equal(service.snapshot().codex?.childStatus, 'running');

  const requested = service.stop();
  assert.equal(requested.accepted, true);
  assert.equal(service.snapshot().status, 'finished');
  assert.equal(service.snapshot().phase, 'finished');
  assert.equal(service.snapshot().codex?.stopRequested, true);

  client.emit(sessionId, { type: 'child-status', status: 'closed', exitCode: 0, expected: true });
  const closed = service.snapshot();
  assert.equal(closed.status, 'finished');
  assert.equal(closed.phase, 'finished');
  assert.equal(closed.codex?.turnStatus, 'completed');
  assert.equal(closed.codex?.childStatus, 'closed');
  assert.match(closed.events.at(-1)?.evidence[0]?.statement ?? '', /closeを観測しました。exitCode=0/);
  assert.match(closed.decision, /終了を確認/);
});

test('stop is idempotent and a delayed turn-start cannot resume a stopping service', () => {
  const { client, service, sessionId } = makeActiveService();
  const stopped = service.stop();
  assert.equal(stopped.accepted, true);
  assert.equal(stopped.code, 'stop_requested');
  assert.equal(service.snapshot().status, 'stopping');
  assert.deepEqual(client.stopSessions, [sessionId]);

  const generationAtStop = service.snapshot().generation;
  const duplicate = service.stop();
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.code, 'stop_already_requested');
  assert.deepEqual(client.stopSessions, [sessionId]);

  client.emit(sessionId, { type: 'turn-started', threadId: THREAD_ID, turnId: 'turn-delayed' });
  assert.equal(service.snapshot().status, 'stopping');
  assert.equal(service.snapshot().generation, generationAtStop);
});

test('old session, thread, and turn notifications cannot change the current session', () => {
  const { client, service, sessionId: oldSessionId } = makeActiveService();
  client.emit(oldSessionId, { type: 'turn-completed', threadId: THREAD_ID, turnId: TURN_ID, status: 'completed' });
  const oldFinishedGeneration = service.snapshot().generation;
  assert.equal(service.snapshot().status, 'finished');

  const restarted = service.start(oldFinishedGeneration);
  assert.equal(restarted.accepted, true);
  const newSessionId = service.snapshot().sessionId;
  assert.ok(newSessionId);
  assert.notEqual(newSessionId, oldSessionId);
  const newSessionGeneration = service.snapshot().generation;

  client.emit(oldSessionId, { type: 'child-status', status: 'closed', expected: true });
  assert.equal(service.snapshot().sessionId, newSessionId);
  assert.equal(service.snapshot().generation, newSessionGeneration);

  client.emit(newSessionId, { type: 'thread-started', threadId: 'thread-new', model: 'test-model', reasoningEffort: 'low' });
  client.emit(newSessionId, { type: 'turn-started', threadId: 'thread-new', turnId: 'turn-new' });
  const currentGeneration = service.snapshot().generation;
  client.emit(newSessionId, {
    type: 'command-completed',
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: 'item-old',
    status: 'completed',
    exitCode: 0,
  });
  client.emit(newSessionId, { type: 'turn-completed', threadId: 'thread-new', turnId: TURN_ID, status: 'failed' });
  assert.equal(service.snapshot().generation, currentGeneration);
  assert.equal(service.snapshot().status, 'running');
  assert.equal(service.snapshot().codex?.threadId, 'thread-new');
  assert.equal(service.snapshot().codex?.turnId, 'turn-new');
});

test('human approval is sent once and a stale resubmission is rejected', () => {
  const { client, service, sessionId } = makeActiveService();
  client.requestApproval(sessionId, approvalRequest());
  const approval = service.snapshot().approval;
  assert.ok(approval);
  assert.equal(approval.status, 'pending');
  assert.equal(approval.canAccept, true);

  const sent = humanDecision(service, sessionId, approval);
  assert.equal(sent.accepted, true);
  assert.deepEqual(client.decisions, [{ sessionId, approvalId: approval.approvalId, decision: 'accept' }]);
  assert.equal(service.snapshot().approval?.status, 'sent');

  const replayed = humanDecision(service, sessionId, approval);
  assert.equal(replayed.accepted, false);
  assert.equal(replayed.code, 'stale_approval');
  assert.equal(client.decisions.length, 1);
});

test('resolved approval revocation cancels the pending decision and blocks later replies', () => {
  const { client, service, sessionId } = makeActiveService();
  client.requestApproval(sessionId, approvalRequest());
  const approval = service.snapshot().approval;
  assert.ok(approval);

  client.emit(sessionId, {
    type: 'approval-revoked',
    approvalId: approval.approvalId,
    reason: 'Codex resolved the request before a human reply.',
  });
  assert.equal(service.snapshot().approval?.status, 'cancelled');
  assert.equal(service.snapshot().status, 'running');

  const lateReply = humanDecision(service, sessionId, approval);
  assert.equal(lateReply.accepted, false);
  assert.equal(lateReply.code, 'stale_approval');
  assert.equal(client.decisions.length, 0);
});

test('terminal turn completion invalidates approval and ignores a late approval callback', () => {
  const { client, service, sessionId } = makeActiveService();
  client.requestApproval(sessionId, approvalRequest());
  const approval = service.snapshot().approval;
  assert.ok(approval);

  client.emit(sessionId, { type: 'approval-response-sent', approvalId: approval.approvalId, decision: 'cancel' });
  client.emit(sessionId, { type: 'turn-completed', threadId: THREAD_ID, turnId: TURN_ID, status: 'completed' });
  assert.equal(service.snapshot().status, 'finished');
  assert.equal(service.snapshot().approval?.status, 'cancelled');
  const terminalGeneration = service.snapshot().generation;

  client.requestApproval(sessionId, approvalRequest({ approvalId: 'approval-after-terminal', requestId: 'rpc-after-terminal' }));
  assert.equal(service.snapshot().generation, terminalGeneration);
  assert.equal(service.snapshot().status, 'finished');
  assert.equal(service.snapshot().approval?.approvalId, approval.approvalId);
  assert.equal(service.snapshot().approval?.status, 'cancelled');
  const lateReply = humanDecision(service, sessionId, approval);
  assert.equal(lateReply.accepted, false);
  assert.equal(lateReply.code, 'stale_approval');
});

test('protocol failure after child close preserves the confirmed closed child state', () => {
  const { client, service, sessionId } = makeActiveService();
  client.emit(sessionId, { type: 'child-status', status: 'closed', exitCode: 0, expected: true });
  assert.equal(service.snapshot().codex?.childStatus, 'closed');

  client.emit(sessionId, { type: 'protocol-failure', message: 'Late protocol report after close.' });
  const snapshot = service.snapshot();
  assert.equal(snapshot.status, 'unknown');
  assert.equal(snapshot.codex?.childStatus, 'closed');
  assert.equal(snapshot.codex?.turnStatus, 'unknown');
});

test('a confirmed child close lets a later start recover from unknown state', () => {
  const { client, service, sessionId } = makeActiveService();
  client.emit(sessionId, { type: 'protocol-failure', message: 'Connection failed.' });
  client.emit(sessionId, { type: 'child-status', status: 'closed', exitCode: 1, expected: true });
  const unknown = service.snapshot();
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.codex?.childStatus, 'closed');
  assert.equal(unknown.codex?.turnStatus, 'unknown');

  const restarted = service.start(unknown.generation);
  assert.equal(restarted.accepted, true);
  assert.notEqual(service.snapshot().sessionId, sessionId);
  assert.equal(service.snapshot().status, 'starting');
});
