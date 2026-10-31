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

test('explain orders confirmed facts, unconfirmed points, and next action without leaking internal IDs or treating unconfirmed state as success', () => {
  const internalIdPattern = /thread-current|turn-current|item-command-current|item-agent-final|rpc-approval-current|approval-current|codex-evidence-|codex-op-/;

  const { client, service } = makeService();
  const initialExplain = service.explain(true);
  assert.match(initialExplain.detail, /まだ作業は始まっていません.*未実施.*『練習タスクを開始』/);
  assert.doesNotMatch(initialExplain.detail, internalIdPattern);

  const sessionId = startService(client, service);
  assert.match(service.explain(true).detail, /接続準備を始めました.*未確認.*『Codex接続を停止』/);

  client.emit(sessionId, { type: 'child-status', status: 'running' });
  client.emit(sessionId, { type: 'thread-started', threadId: THREAD_ID, model: 'test-model', reasoningEffort: 'low' });
  assert.match(service.explain(true).detail, /安全設定を確認しました.*未確認.*『Codex接続を停止』/);
  assert.doesNotMatch(service.explain(true).detail, internalIdPattern);
  assert.ok(service.explain(true).evidence.some((entry) => entry.statement.includes(THREAD_ID)));

  client.emit(sessionId, { type: 'turn-started', threadId: THREAD_ID, turnId: TURN_ID });
  assert.match(service.explain(true).detail, /読み取り作業を始めています.*未確認.*『Codex接続を停止』/);
  assert.doesNotMatch(service.explain(true).detail, internalIdPattern);

  client.requestApproval(sessionId, approvalRequest());
  assert.match(service.explain(true).detail, /実行確認が届いています.*実行されておらず.*『Codexの要求を承認』または『Codexの要求を拒否』/);
  assert.doesNotMatch(service.explain(true).detail, internalIdPattern);
  humanDecision(service, sessionId, service.snapshot().approval!, 'approve');
  assert.match(service.explain(true).detail, /承認をAIへ送りました.*未確認.*『Codex接続を停止』/);

  client.emit(sessionId, {
    type: 'command-completed',
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: 'item-command-current',
    status: 'completed',
    exitCode: 0,
  });
  assert.match(service.explain(true).detail, /読み取り処理が正常に終了したことを確認しました.*AIの回答と作業全体の完了はまだ未確認.*『Codex接続を停止』/);
  assert.doesNotMatch(service.explain(true).detail, internalIdPattern);

  client.emit(sessionId, {
    type: 'agent-message-completed',
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: 'item-agent-final',
    text: '営業時間は平日9時から17時です。',
    finalAnswer: true,
  });
  assert.match(service.explain(true).detail, /読み取り処理の正常終了とAIからの回答受信を確認しました.*回答内容の正しさと作業全体の完了通知はまだ未確認.*『Codex接続を停止』/);
  assert.doesNotMatch(service.explain(true).detail, internalIdPattern);

  client.emit(sessionId, { type: 'turn-completed', threadId: THREAD_ID, turnId: TURN_ID, status: 'completed' });
  const finishedExplain = service.explain(true);
  assert.equal(
    finishedExplain.detail,
    'AIから回答を受け取りました。内容の正しさは未確認です。AIとの接続は続いています。終了する場合は『Codex接続を停止』を選んでください。',
  );
  assert.doesNotMatch(finishedExplain.detail, internalIdPattern);
  assert.ok(finishedExplain.evidence.some((entry) => entry.statement.includes(TURN_ID)));

  service.stop();
  assert.match(service.explain(true).detail, /AIから回答を受け取り、作業完了を確認しました.*内容の正しさとAIとの接続終了はまだ未確認.*お待ちください/);

  client.emit(sessionId, { type: 'child-status', status: 'closed', exitCode: 0, expected: true });
  assert.equal(
    service.explain(true).detail,
    'AIから回答を受け取り、AIとの接続終了も確認しました。回答内容の正しさは未確認です。もう一度試す場合は『もう一度実行』を選んでください。',
  );

  for (const [status, expectedPattern] of [
    ['failed', /読み取り処理は失敗しましたが、AIから回答を受け取りました。内容の正しさは未確認です。/],
    ['declined', /コマンド実行は拒否されましたが、AIから回答を受け取りました。内容の正しさは未確認です。/],
  ] as const) {
    const branch = makeActiveService();
    branch.client.emit(branch.sessionId, {
      type: 'command-completed',
      threadId: THREAD_ID,
      turnId: TURN_ID,
      itemId: 'item-command-current',
      status,
      exitCode: status === 'failed' ? 1 : null,
    });
    branch.client.emit(branch.sessionId, {
      type: 'agent-message-completed',
      threadId: THREAD_ID,
      turnId: TURN_ID,
      itemId: 'item-agent-final',
      text: '読めたつもりです。',
      finalAnswer: true,
    });
    branch.client.emit(branch.sessionId, { type: 'turn-completed', threadId: THREAD_ID, turnId: TURN_ID, status: 'completed' });
    assert.match(branch.service.explain(true).detail, expectedPattern);
    assert.doesNotMatch(branch.service.explain(true).detail, /正常に終了/);
  }

  const unknownBranch = makeActiveService();
  unknownBranch.client.emit(unknownBranch.sessionId, { type: 'protocol-failure', message: 'broken pipe' });
  assert.match(unknownBranch.service.explain(true).detail, /確認できません.*未確認.*成功とは扱っていません/);
});

test('a failed turn separates the partial command result from the failed turn and never claims that no work was completed', () => {
  const outcomes = [
    {
      label: 'completed with exit code 0',
      command: { status: 'completed' as const, exitCode: 0 },
      expected: /途中の読み取り処理は正常に終了しましたが、AIの作業全体は失敗しました。/,
    },
    {
      label: 'failed',
      command: { status: 'failed' as const, exitCode: 1 },
      expected: /途中の読み取り処理とAIの作業全体が失敗したことを確認しました。/,
    },
    {
      label: 'declined',
      command: { status: 'declined' as const, exitCode: null },
      expected: /コマンド実行は拒否され、AIの作業全体も失敗したことを確認しました。/,
    },
    {
      label: 'completed with a non-zero exit code',
      command: { status: 'completed' as const, exitCode: 1 },
      expected: /読み取り処理の終了通知は届きましたが正常終了は未確認で、AIの作業全体は失敗しました。/,
    },
    {
      label: 'completed with an unknown exit code',
      command: { status: 'completed' as const, exitCode: null },
      expected: /読み取り処理の終了通知は届きましたが正常終了は未確認で、AIの作業全体は失敗しました。/,
    },
    {
      label: 'not run',
      command: null,
      expected: /AIの作業全体が失敗したことを確認しました。途中の処理がどこまで進んだかは未確認です。/,
    },
  ];

  for (const outcome of outcomes) {
    const { client, service, sessionId } = makeActiveService();
    if (outcome.command) {
      client.emit(sessionId, {
        type: 'command-completed',
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: 'item-command-current',
        status: outcome.command.status,
        exitCode: outcome.command.exitCode,
      });
    }
    client.emit(sessionId, { type: 'turn-completed', threadId: THREAD_ID, turnId: TURN_ID, status: 'failed' });

    const snapshot = service.snapshot();
    assert.equal(snapshot.status, 'failed', outcome.label);
    assert.equal(snapshot.codex?.turnStatus, 'failed', outcome.label);
    assert.match(snapshot.decision, /AIの作業全体/, outcome.label);
    assert.doesNotMatch(snapshot.decision, /完了した作業はありません|完了した作業はなく/, outcome.label);

    const detail = service.explain(true).detail;
    assert.match(detail, outcome.expected, outcome.label);
    assert.doesNotMatch(detail, /完了した作業はありません|完了した作業はなく/, outcome.label);
    assert.match(detail, /AIとの接続は続いています/, outcome.label);
    assert.match(detail, /未確認です/, outcome.label);
    assert.match(detail, /終了する場合は『Codex接続を停止』を選んでください。$/, outcome.label);

    const confirmedIndex = detail.indexOf('AIの作業全体');
    const unconfirmedIndex = detail.indexOf('未確認です');
    const nextIndex = detail.indexOf('『Codex接続を停止』');
    assert.ok(confirmedIndex >= 0 && confirmedIndex < unconfirmedIndex, outcome.label);
    assert.ok(unconfirmedIndex < nextIndex, outcome.label);
  }
});

test('a failed turn with a closed child reports the connection end and the restart action without claiming no work was completed', () => {
  const { client, service, sessionId } = makeActiveService();
  client.emit(sessionId, {
    type: 'command-completed',
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: 'item-command-current',
    status: 'completed',
    exitCode: 0,
  });
  client.emit(sessionId, { type: 'turn-completed', threadId: THREAD_ID, turnId: TURN_ID, status: 'failed' });
  client.emit(sessionId, { type: 'child-status', status: 'closed', exitCode: 0, expected: true });

  const snapshot = service.snapshot();
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.codex?.childStatus, 'closed');

  const detail = service.explain(true).detail;
  assert.match(detail, /途中の読み取り処理は正常に終了しましたが、AIの作業全体は失敗しました。/);
  assert.match(detail, /AIとの接続終了も確認しました。/);
  assert.match(detail, /失敗の原因と、エラーの詳しい内容は未確認です。/);
  assert.match(detail, /もう一度試す場合は『もう一度実行』を選んでください。$/);
  assert.doesNotMatch(detail, /完了した作業はありません|完了した作業はなく/);
  assert.doesNotMatch(snapshot.decision, /完了した作業はありません|完了した作業はなく/);
  assert.equal(
    snapshot.decision,
    '途中の読み取り処理は正常に終了しましたが、AIの作業全体は失敗しました。AIとの接続終了も確認しました。もう一度試す場合は『もう一度実行』を選んでください。',
  );

  const confirmedIndex = detail.indexOf('AIの作業全体');
  const unconfirmedIndex = detail.indexOf('未確認です');
  const nextIndex = detail.indexOf('『もう一度実行』');
  assert.ok(confirmedIndex >= 0 && confirmedIndex < unconfirmedIndex);
  assert.ok(unconfirmedIndex < nextIndex);
});

test('stopping a finished, failed, or interrupted turn keeps answer completion, failure, and interruption distinct', () => {
  const cases = [
    {
      label: 'finished',
      turnStatus: 'completed' as const,
      status: 'finished' as const,
      message: 'AIの回答作業は完了しています。Codexとの接続終了を確認しています。',
      decision: 'AIの回答作業は完了しています。AIとの接続終了を確認しています。',
      detail: /作業完了を確認しました.*AIとの接続終了はまだ未確認.*接続が閉じるまでお待ちください/,
    },
    {
      label: 'failed',
      turnStatus: 'failed' as const,
      status: 'failed' as const,
      message: 'AIの作業は失敗しています。Codexとの接続終了を確認しています。',
      decision: 'AIの作業は失敗しています。AIとの接続終了を確認しています。',
      detail: /AIの作業全体が失敗したことを確認しました.*AIとの接続終了を確認しています.*接続終了の確認が終わるまでお待ちください/,
    },
    {
      label: 'interrupted',
      turnStatus: 'interrupted' as const,
      status: 'interrupted' as const,
      message: 'AIの作業は中断しています。Codexとの接続終了を確認しています。',
      decision: 'AIの作業は中断しています。AIとの接続終了を確認しています。',
      detail: /AIの作業中断を確認しました.*AIとの接続終了を確認しています.*接続終了の確認が終わるまでお待ちください/,
    },
  ];

  for (const item of cases) {
    const { client, service, sessionId } = makeActiveService();
    client.emit(sessionId, { type: 'turn-completed', threadId: THREAD_ID, turnId: TURN_ID, status: item.turnStatus });
    assert.equal(service.snapshot().status, item.status, item.label);
    assert.equal(service.snapshot().codex?.childStatus, 'running', item.label);
    assert.equal(service.snapshot().codex?.stopRequested, false, item.label);

    const stopped = service.stop();
    assert.equal(stopped.accepted, true, item.label);
    assert.equal(stopped.code, 'stop_requested', item.label);
    assert.equal(stopped.message, item.message, item.label);
    assert.equal(service.snapshot().codex?.stopRequested, true, item.label);
    assert.equal(service.snapshot().decision, item.decision, item.label);

    const detail = service.explain(true).detail;
    assert.match(detail, item.detail, item.label);

    if (item.status !== 'finished') {
      assert.doesNotMatch(stopped.message, /回答作業は完了|作業は完了/, item.label);
      assert.doesNotMatch(service.snapshot().decision, /回答作業は完了|作業は完了/, item.label);
      assert.doesNotMatch(detail, /回答作業は完了|作業は完了/, item.label);
    }
  }
});
