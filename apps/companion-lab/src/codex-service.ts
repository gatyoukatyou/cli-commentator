import { randomUUID } from 'node:crypto';
import type {
  ApprovalRecord,
  ApprovalStatus,
  CodexRuntimeState,
  Evidence,
  LabEvent,
  LabPhase,
  LabSnapshot,
  LabStatus,
  OperationResult,
} from './core.js';
import { CodexAppServerClient, type CodexApprovalRequest, type CodexClientObserver, type CodexObservation } from './codex-client.js';

const MAX_EVENTS = 100;
const MAX_TEXT_CHARS = 4000;

/**
 * Real Codex-backed companion service. It has the same synchronous operation
 * surface as the fictional service; asynchronous app-server events update the
 * same in-memory snapshot through the observer callbacks below.
 */
export class CodexCompanionLabService implements CodexClientObserver {
  readonly source = 'codex' as const;
  readonly simulationOnly = false as const;
  private status: LabStatus = 'not-started';
  private phase: LabPhase = 'not-started';
  private generation = 0;
  private operationSequence = 0;
  private sessionId: string | null = null;
  private updatedAt: string | null = null;
  private currentOperationId: string | null = null;
  private currentWork = '開始すると、AIが練習用ファイルを読み取ります。';
  private changed = 'まだ作業は始まっていません。';
  private decision = 'Codexの既存の認証・利用枠を使います（ChatGPTログインの場合はサブスク枠）。自由な依頼や作業場所は指定できません。';
  private approval: ApprovalRecord | null = null;
  private events: LabEvent[] = [];
  private codex: CodexRuntimeState = {
    childStatus: 'not-started',
    childExitCode: null,
    threadId: null,
    turnId: null,
    turnStatus: 'not-started',
    itemId: null,
    model: null,
    reasoningEffort: null,
    finalReport: null,
    stopRequested: false,
  };
  private readonly client: CodexAppServerClient;
  private readonly safeApproval = new Map<string, boolean>();

  constructor(client = new CodexAppServerClient()) {
    this.client = client;
  }

  snapshot(): LabSnapshot {
    return structuredClone({
      simulationOnly: false,
      source: 'codex' as const,
      capabilities: { start: true, advance: false, hold: false, humanDecision: true, stop: true },
      codex: this.codex,
      sessionId: this.sessionId,
      status: this.status,
      phase: this.phase,
      phaseLabel: codexPhaseLabel(this.phase),
      generation: this.generation,
      currentOperationId: this.currentOperationId,
      updatedAt: this.updatedAt,
      currentWork: this.currentWork,
      changed: this.changed,
      decision: this.decision,
      approval: this.approval,
      events: this.events,
    });
  }

  start(expectedGeneration: number): OperationResult {
    const operationId = this.nextOperationId();
    if (expectedGeneration !== this.generation) {
      return this.result(false, 'stale_generation', '画面の状態が更新されています。最新の状態を確認してから開始してください。', operationId);
    }
    const recoverableUnknown = this.status === 'unknown' && this.codex.childStatus === 'closed';
    if (this.status === 'unknown' && !recoverableUnknown) {
      return this.result(false, 'state_unknown', 'AIとの接続状態を確認できないため、新しい作業を始められません。', operationId);
    }
    if (this.status !== 'not-started' && !isTerminal(this.status) && !recoverableUnknown) {
      return this.result(false, 'already_started', 'すでに作業の準備中か、進行中です。', operationId);
    }

    this.sessionId = randomUUID();
    this.status = 'starting';
    this.phase = 'codex-starting';
    this.approval = null;
    this.safeApproval.clear();
    this.events = [];
    this.codex = {
      childStatus: 'starting',
      childExitCode: null,
      threadId: null,
      turnId: null,
      turnStatus: 'not-started',
      itemId: null,
      model: null,
      reasoningEffort: null,
      finalReport: null,
      stopRequested: false,
    };
    this.currentWork = '練習用ファイルを準備し、AIとの接続設定を確認しています。';
    this.changed = 'まだ作業は始まっていません。';
    this.decision = 'Codexの既存の認証・利用枠を使います（ChatGPTログインの場合はサブスク枠）。安全設定の確認が済むまで依頼を送りません。';
    this.record(operationId, 'codex-starting', [
      this.evidence('service-operation', '共通サービスが固定のsample.txt読取タスクの開始要求を受け取りました。'),
    ], [
      '練習用ファイルを準備しているよ。',
      '安全な接続設定を確認してからAIに依頼します。',
    ]);
    this.client.start(this.sessionId, this);
    return this.result(true, 'started', 'AIとの接続準備を始めました。', operationId);
  }

  advance(_expectedGeneration: number): OperationResult {
    const operationId = this.nextOperationId();
    return this.result(false, 'unsupported_in_codex_mode', '実接続では手動で一段進められません。AIが実際の作業を進めます。', operationId);
  }

  hold(): OperationResult {
    const operationId = this.nextOperationId();
    return this.result(false, 'unsupported_in_codex_mode', '実接続では作業を一時保留できません。止める場合は停止操作を使ってください。', operationId);
  }

  stop(): OperationResult {
    const operationId = this.nextOperationId();
    if (!this.sessionId || this.status === 'not-started') {
      return this.result(false, 'not_started', '停止する作業はありません。', operationId);
    }
    if (isTerminal(this.status) && this.codex.childStatus === 'closed') {
      return this.result(false, 'terminal', '作業とAIとの接続はすでに終了しています。', operationId);
    }
    if (this.status === 'stopping' && this.codex.stopRequested) {
      return this.result(true, 'stop_already_requested', '停止を依頼済みです。終了の確認を待っています。', operationId);
    }

    if (!isTerminal(this.status)) {
      this.status = 'stopping';
      this.phase = 'codex-stopping';
      this.decision = '停止を依頼しました。AIの作業が止まったかを確認しています。';
    } else {
      this.decision = '作業は終了しました。AIとの接続終了を確認しています。';
    }
    this.codex = { ...this.codex, stopRequested: true };
    this.record(operationId, this.status === 'stopping' ? 'codex-stopping' : this.phase, [
          this.evidence('service-operation', '共通サービスがCodexタスクまたは専用子プロセスの停止要求を受け取りました。'),
    ], [
      '停止を依頼したよ。作業が止まったかと接続終了を別々に確かめるね。',
      '停止の返事だけで終了とはせず、実際の状態を確認します。',
    ]);
    if (!this.client.stop(this.sessionId)) {
      this.status = 'unknown';
      this.phase = 'codex-unknown';
      this.codex = { ...this.codex, turnStatus: 'unknown', childStatus: 'unknown' };
      this.currentWork = '停止対象の接続を確認できません。';
      this.changed = '停止を依頼できたか確認できません。';
      this.decision = 'AIの作業が止まったか分からないため、完了とは判断していません。';
      this.record(this.nextOperationId(), 'codex-unknown', [
        this.evidence('owned-child', '停止対象の専用子プロセスを特定できませんでした。'),
      ], [
        'AIとの接続先を確認できない状態だよ。',
        '終了したとは扱わず、状態不明として記録します。',
      ]);
      return this.result(false, 'connection_unknown', 'AIの作業停止を確認できません。', operationId);
    }
    return this.result(true, 'stop_requested', '停止を依頼しました。作業の停止とAIとの接続終了を確認しています。', operationId);
  }

  decideFromHuman(input: {
    sessionId: string;
    approvalId: string;
    expectedGeneration: number;
    decision: 'approve' | 'reject';
  }): OperationResult {
    const operationId = this.nextOperationId();
    if (input.sessionId !== this.sessionId) {
      return this.result(false, 'session_mismatch', 'この返答は現在の作業に結びついていません。', operationId);
    }
    if (
      this.status !== 'awaiting-human'
      || this.approval?.status !== 'pending'
      || input.approvalId !== this.approval.approvalId
      || input.expectedGeneration !== this.approval.expectedGeneration
      || input.expectedGeneration !== this.generation
    ) {
      return this.result(false, 'stale_approval', 'この返答は古いか、すでに処理されています。最新の状態を確認してください。', operationId);
    }
    if (input.decision === 'approve' && !this.safeApproval.get(input.approvalId)) {
      return this.result(false, 'unsafe_preview', '練習用ファイルだけを読む内容と確認できないため、実行を許可できません。', operationId);
    }

    const codexDecision = input.decision === 'approve' ? 'accept' : 'decline';
    const sent = this.client.respond(input.sessionId, input.approvalId, codexDecision);
    if (!sent) {
      this.status = 'unknown';
      this.phase = 'codex-unknown';
      this.codex = { ...this.codex, turnStatus: 'unknown' };
      this.approval = { ...this.approval, status: 'unknown' };
      this.currentWork = '返答をAIへ届けられませんでした。';
      this.changed = '作業結果を確認できていません。';
      this.decision = '接続状態が分からないため、作業完了とは判断していません。';
      this.record(operationId, 'codex-unknown', [
        this.evidence('owned-child', '人の返答をapp-serverへ送信できたことを確認できませんでした。'),
      ], [
        '返答を届けられたか分からない状態だよ。',
        '返答が届いたものとして扱わず、状態不明に切り替えます。',
      ]);
      return this.result(false, 'approval_send_failed', '返答がAIに届いたか確認できません。', operationId);
    }

    this.safeApproval.delete(input.approvalId);
    this.approval = { ...this.approval, status: codexDecision === 'accept' ? 'sent' : 'decline' };
    this.status = 'running';
    this.phase = 'codex-running';
    this.currentWork = '一回限りの返答をAIへ送りました。作業結果を待っています。';
    this.changed = codexDecision === 'accept'
      ? '一回限りの実行を認める返答を送りました。実行結果はまだ確認できていません。'
      : '実行を拒否する返答を送りました。AIの作業結果はまだ確認できていません。';
    this.decision = '返答の送信と実際の作業結果を分けて確認します。';
    this.record(operationId, 'codex-running', [
      this.evidence('human-ui', codexDecision === 'accept'
        ? '利用者が一回限りの実行承認を選び、app-serverへacceptを送信しました。'
        : '利用者が実行を拒否し、app-serverへdeclineを送信しました。'),
    ], [
      codexDecision === 'accept' ? '一回限りの実行許可を送ったよ。' : '実行を拒否したよ。',
      '返答の送信と実際の作業結果は別です。作業完了の通知を待ちます。',
    ]);
    return this.result(true, codexDecision === 'accept' ? 'approval_sent' : 'decline_sent', '返答をAIへ送りました。作業結果はまだ確認できていません。', operationId);
  }

  explain(detail = false): { simulationOnly: false; source: 'codex'; summary: string; detail: string; evidence: Evidence[]; generation: number } {
    const current = this.snapshot();
    const latest = current.events.at(-1);
    const summary = `${current.phaseLabel}: ${current.currentWork} ${current.changed} ${current.decision}`;
    const detailText = detail
      ? `${summary}${current.codex?.finalReport ? ` AIの報告（未検証）: ${current.codex.finalReport}` : ''}`
      : current.decision;
    return {
      simulationOnly: false,
      source: 'codex',
      summary,
      detail: truncate(detailText, MAX_TEXT_CHARS),
      evidence: latest ? structuredClone(latest.evidence) : [],
      generation: current.generation,
    };
  }

  summarize(): { simulationOnly: false; source: 'codex'; summary: string; generation: number; eventCount: number } {
    const current = this.snapshot();
    const observations = current.events.map((event) => event.phaseLabel).join(' → ') || '未開始';
    return {
      simulationOnly: false,
      source: 'codex',
      summary: `Codexと実際に接続しています。現在は「${current.phaseLabel}」です。これまでの状態: ${observations}。${current.changed} ${current.decision}`,
      generation: current.generation,
      eventCount: current.events.length,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  onObservation(sessionId: string, observation: CodexObservation): void {
    if (!this.isCurrentSession(sessionId)) return;
    if (isTerminal(this.status) && observation.type !== 'child-status') return;
    if (this.status === 'stopping' && [
      'thread-started', 'turn-started', 'item-started', 'command-completed', 'agent-message-completed', 'unsupported-request',
    ].includes(observation.type)) return;
    const operationId = this.nextOperationId();
    switch (observation.type) {
      case 'child-status':
        this.applyChildStatus(observation, operationId);
        return;
      case 'thread-started':
        this.codex = {
          ...this.codex,
          threadId: observation.threadId,
          model: observation.model,
          reasoningEffort: observation.reasoningEffort,
        };
        this.currentWork = '練習用ファイルを使うAIとの接続を準備しました。';
        this.changed = '読み取り専用で通信を行わない設定を確認しました。';
        this.decision = '固定された練習用ファイルの読み取りを始めます。';
        this.record(operationId, 'codex-starting', [
          this.evidence('sample-file', 'アプリが機密を含まない短い日本語sample.txtを一時ディレクトリに作成しました。'),
          this.evidence('codex-app-server', `Codexがephemeral thread ${observation.threadId} を作成し、model=${observation.model} を返しました。`),
        ], [
          '練習用ファイルを使うAIとの接続ができたよ。',
          '読み取り専用で通信を行わない設定を確かめました。',
        ]);
        return;
      case 'turn-started':
        if (!this.matchesThreadTurn(observation.threadId, observation.turnId)) return;
        this.codex = { ...this.codex, threadId: observation.threadId, turnId: observation.turnId, turnStatus: 'inProgress' };
        this.status = 'running';
        this.phase = 'codex-running';
        this.currentWork = 'AIが練習用ファイルを読み取っています。';
        this.changed = 'AIの作業開始を確認しました。';
        this.decision = '作業の完了通知はまだ届いていません。';
        this.record(operationId, 'codex-running', [
          this.evidence('codex-app-server', `thread ${observation.threadId} のturn ${observation.turnId} が開始されました。`),
        ], [
          'AIの読み取り作業が始まったよ。',
          '開始通知だけでは完了や成功とは判断していません。',
        ]);
        return;
      case 'item-started':
        if (!this.matchesThreadTurn(observation.threadId, observation.turnId)) return;
        this.codex = { ...this.codex, itemId: observation.itemId };
        this.currentWork = `AIが${describeItem(observation.itemType)}を始めました。`;
        this.changed = observation.preview ? `実行前の内容: ${observation.preview}` : '作業の開始を確認しました。結果はまだありません。';
        this.decision = 'AIの作業全体が終わるまで確認を続けます。';
        this.record(operationId, 'codex-running', [
          this.evidence('codex-app-server', `item/startedで${observation.itemType}の開始を観測しました。itemId=${observation.itemId}`),
        ], [
          'AIの処理が始まったよ。',
          '開始通知は途中経過です。終了結果は別の通知で確かめます。',
        ]);
        return;
      case 'command-completed':
        if (!this.matchesThreadTurn(observation.threadId, observation.turnId)) return;
        this.codex = { ...this.codex, itemId: observation.itemId };
        this.status = 'running';
        this.phase = 'codex-running';
        this.currentWork = observation.status === 'declined'
          ? '実行は拒否され、行われませんでした。'
          : observation.status === 'failed'
            ? '読み取り処理に失敗しました。'
            : '読み取り処理が終了しました。';
        this.changed = observation.status === 'declined'
          ? '実行されなかったことを確認しました。'
          : observation.status === 'failed'
            ? '読み取り処理の失敗を確認しました。'
            : observation.exitCode === null
              ? '終了通知は届きましたが、正常に終わったかは確認できていません。'
              : observation.status === 'completed' && observation.exitCode === 0
                ? '読み取り処理が正常に終了しました。'
                : '読み取り処理は終了しましたが、正常に終わったか確認できていません。';
        this.decision = '読み取り処理の終了とAIの回答作業完了を分けて確認しています。';
        this.record(operationId, 'codex-running', [
          this.evidence('codex-app-server', `commandExecution item ${observation.itemId} がstatus=${observation.status}・exitCode=${observation.exitCode ?? '不明'}で完了しました。`),
        ], [
          observation.status === 'declined'
            ? '実行は拒否され、行われていないよ。'
            : observation.status === 'completed' && observation.exitCode === 0
              ? '読み取り処理は正常に終わったよ。'
              : '読み取り処理の結果を確認したよ。',
          '読み取り処理の結果だけでは、AIの回答作業全体が終わったとは判断しません。',
        ]);
        return;
      case 'agent-message-completed':
        if (!this.matchesThreadTurn(observation.threadId, observation.turnId) || !observation.finalAnswer) return;
        this.codex = { ...this.codex, finalReport: truncate(observation.text, MAX_TEXT_CHARS), itemId: observation.itemId };
        this.currentWork = 'AIから回答を受け取りました。作業完了の通知を待っています。';
        this.changed = `AIの報告（未検証）: ${truncate(observation.text, MAX_TEXT_CHARS)}`;
        this.decision = '回答の受信と作業完了は別です。回答内容も独立に確認した結果ではありません。';
        this.record(operationId, 'codex-running', [
          this.evidence('codex-app-server', `agentMessage final_answer item ${observation.itemId} の完了を受け取りました。内容はAIの報告で、独立検証ではありません。`),
        ], [
          'AIから回答が届いたよ。',
          '回答の受信と作業完了は別です。回答内容も別に確かめた結果ではありません。',
        ]);
        return;
      case 'turn-completed':
        if (!this.matchesThreadTurn(observation.threadId, observation.turnId)) return;
        this.codex = { ...this.codex, turnStatus: observation.status };
        if (observation.status === 'completed') {
          this.status = 'finished';
          this.phase = 'finished';
          this.currentWork = 'AIの回答作業が完了しました。';
          this.changed = this.codex.finalReport
            ? 'AIの回答作業が完了しました。'
            : 'AIの作業は完了しましたが、回答本文はありません。';
          this.decision = this.codex.finalReport
            ? 'AIの回答内容の正しさは別途確認が必要です。AIとの接続は動作中のため、停止操作で終了を確認してください。'
            : '回答がないため内容は不明です。AIとの接続は動作中のため、停止操作で終了を確認してください。';
        } else if (observation.status === 'failed') {
          this.status = 'failed';
          this.phase = 'codex-failed';
          this.currentWork = 'AIの作業に失敗しました。';
          this.changed = 'AIの作業が失敗したことを確認しました。';
          this.decision = 'エラーの詳しい内容は表示していません。AIとの接続が続いている場合は停止してください。';
        } else {
          this.status = 'interrupted';
          this.phase = 'codex-interrupted';
          this.currentWork = 'AIの作業が中断されたことを確認しました。';
          this.changed = 'AIの作業が中断しました。';
          this.decision = 'AIの作業停止を確認しました。AIとの接続終了は別に確認します。';
        }
        this.record(operationId, this.phase, [
          this.evidence('codex-app-server', `thread ${observation.threadId} のturn ${observation.turnId} が ${observation.status} で完了しました。`),
        ], [
          observation.status === 'completed' ? 'AIの回答作業が終わったよ。' : observation.status === 'failed' ? 'AIの作業は失敗したよ。' : 'AIの作業は中断したよ。',
          observation.status === 'completed'
            ? '作業完了を確認しました。回答の内容が正しいかまでは確かめていません。'
            : 'AIとの接続が終了したかも別に確認します。',
        ]);
        return;
      case 'approval-response-sent': {
        if (!this.approval || this.approval.approvalId !== observation.approvalId || this.approval.status !== 'pending') return;
        const status: ApprovalStatus = observation.decision === 'accept'
          ? 'sent'
          : observation.decision === 'cancel' ? 'cancelled' : observation.decision;
        this.approval = { ...this.approval, status };
        this.safeApproval.delete(observation.approvalId);
        const stopping = this.status === 'stopping';
        if (!stopping) {
          this.status = 'running';
          this.phase = 'codex-running';
        }
        this.currentWork = observation.decision === 'cancel'
          ? '承認の確認を取り消しました。AIの作業停止を確認しています。'
          : '返答をAIへ送りました。読み取り処理の結果を待っています。';
        this.changed = observation.decision === 'accept'
          ? '一回限りの実行許可を送りました。実行結果はまだ確認できていません。'
          : '一回限りの返答を送りました。AIの作業結果はまだ確認できていません。';
        this.decision = observation.decision === 'cancel'
          ? '停止を依頼済みです。作業の停止とAIとの接続終了を別々に確認します。'
          : '返答の送信と実際の作業結果を分けて確認します。';
        this.record(operationId, stopping ? 'codex-stopping' : 'codex-running', [
          this.evidence('owned-child', `${observation.decision}応答を専用app-server子へ送信できました。`),
        ], [
          '一回だけの返答を送ったよ。',
          '返答を送ったことと、実際に実行されたかは別に確かめます。',
        ]);
        return;
      }
      case 'approval-revoked':
        if (!this.approval || this.approval.approvalId !== observation.approvalId || this.approval.status !== 'pending') return;
        this.safeApproval.delete(observation.approvalId);
        this.approval = { ...this.approval, status: 'cancelled' };
        if (this.status === 'awaiting-human') {
          this.status = 'running';
          this.phase = 'codex-running';
        }
        this.currentWork = '承認の確認は終了しました。';
        this.changed = '承認の確認は取り消されました。';
        this.decision = 'この承認はもう使えません。最新の状態を確認してください。';
        this.record(operationId, this.phase, [
          this.evidence('codex-app-server', observation.reason),
        ], [
          '承認の確認は取り消されたよ。',
          'この承認は使えません。新しい状態から確認し直してください。',
        ]);
        return;
      case 'startup-stopped':
        if (observation.confirmedNoTurn) {
          this.status = 'stopped';
          this.phase = 'stopped';
          this.codex = { ...this.codex, childStatus: 'closed', turnStatus: 'not-started' };
          this.currentWork = '作業を始める前に準備を止めました。';
          this.changed = 'AIへ作業を依頼する前に停止したことを確認しました。';
          this.decision = '停止済みです。AIの作業は始まっていません。';
          this.record(operationId, 'stopped', [
            this.evidence('owned-child', 'Codexターン開始前に準備処理を停止し、対象の子プロセスを閉じました。'),
          ], [
            '準備中に停止したよ。',
            'AIへ依頼する前だったため、止める作業はありませんでした。',
          ]);
        } else {
          this.status = 'unknown';
          this.phase = 'codex-unknown';
          this.codex = { ...this.codex, childStatus: 'closed', turnStatus: 'unknown' };
          this.currentWork = '準備を止めましたが、AIの作業状態を確認できません。';
          this.changed = 'AIの作業が止まったか確認できていません。';
          this.decision = '作業が停止したとは判断していません。';
          this.record(operationId, 'codex-unknown', [
            this.evidence('owned-child', 'ターン停止通知を確認できず、専用子プロセスを閉じました。'),
          ], [
            '準備を止めたけれど、AIの作業状態は分からないよ。',
            '接続を終了したことと、作業停止の確認は分けて扱います。',
          ]);
        }
        return;
      case 'stop-unconfirmed':
        this.status = 'unknown';
        if (!isTerminalTurnStatus(this.codex.turnStatus)) this.phase = 'codex-unknown';
        this.codex = {
          ...this.codex,
          turnStatus: isTerminalTurnStatus(this.codex.turnStatus) ? this.codex.turnStatus : 'unknown',
        };
        this.currentWork = 'AIの作業が止まったか確認できません。';
        this.changed = '停止が確認できる返答はありませんでした。';
        this.decision = '作業停止は未確認です。AIとの接続終了を別に待っています。';
        this.record(operationId, isTerminalTurnStatus(this.codex.turnStatus) ? this.phase : 'codex-unknown', [
          this.evidence('owned-child', observation.reason),
        ], [
          '停止の確認が届かず、状態が分からないよ。',
          '停止済みとは表示せず、AIとの接続終了も別に確認します。',
        ]);
        return;
      case 'unsupported-request':
        this.currentWork = '対応できない要求を取り消しました。';
        this.changed = '安全のため、対応できない要求を拒否しました。';
        this.decision = 'AIの作業が続いているか、完了通知で確認します。';
        this.record(operationId, 'codex-running', [
          this.evidence('codex-app-server', `未対応のserver request ${truncate(observation.method, 200)} を拒否しました。`),
        ], [
          '対応できない要求を取り消したよ。',
          '作業が止まったかは、完了通知を待って判断します。',
        ]);
        return;
      case 'protocol-failure':
        this.status = 'unknown';
        if (!isTerminalTurnStatus(this.codex.turnStatus)) this.phase = 'codex-unknown';
        this.codex = {
          ...this.codex,
          turnStatus: isTerminalTurnStatus(this.codex.turnStatus) ? this.codex.turnStatus : 'unknown',
          childStatus: this.codex.childStatus === 'closed' ? 'closed' : 'unknown',
        };
        this.currentWork = 'AIとの接続状態を確認できません。';
        this.changed = 'AIからの応答を確認できませんでした。';
        this.decision = '作業の完了状態は不明です。成功とは扱っていません。';
        this.record(operationId, isTerminalTurnStatus(this.codex.turnStatus) ? this.phase : 'codex-unknown', [
          this.evidence('codex-app-server', observation.message),
        ], [
          'AIの応答を確認できないよ。',
          '不明な状態を成功にせず、作業完了は未確認として扱います。',
        ]);
        return;
    }
  }

  onApproval(sessionId: string, request: CodexApprovalRequest): void {
    if (!this.isCurrentSession(sessionId)) return;
    if (this.status !== 'running' || isTerminal(this.status)) return;
    if (
      this.approval?.status === 'pending'
      || request.threadId !== this.codex.threadId
      || request.turnId !== this.codex.turnId
    ) return;
    const operationId = this.nextOperationId();
    this.status = 'awaiting-human';
    this.phase = 'approval';
    this.safeApproval.set(request.approvalId, request.canAccept);
    this.approval = {
      approvalId: request.approvalId,
      sessionId,
      expectedGeneration: this.generation + 1,
      status: 'pending',
      title: request.title,
      details: [
        request.reason ? `AIが示した理由: ${request.reason}` : 'AIから理由の説明はありません。',
        request.blockedReason ?? 'この許可は読み取り専用の制限を越える実行に対する一回限りのものです。継続的な許可や設定変更は行いません。',
      ].join('\n'),
      kind: 'commandExecution',
      requestId: request.requestId,
      threadId: request.threadId,
      turnId: request.turnId,
      itemId: request.itemId,
      preview: request.preview,
      canAccept: request.canAccept,
      blockedReason: request.blockedReason,
    };
        this.currentWork = 'AIから実行内容の確認を求められています。';
        this.changed = request.preview;
        this.decision = request.canAccept
      ? '表示された内容を確認してください。実行を認める場合も一回限りで、読み取り専用の範囲外への許可です。拒否も選べます。'
      : '表示内容が読み取り専用の範囲内と確認できないため、許可できません。拒否するか作業を停止してください。';
    this.record(operationId, 'approval', [
      this.evidence('codex-app-server', `thread=${request.threadId} turn=${request.turnId} item=${request.itemId} request=${request.requestId} の承認を受信しました。`),
    ], [
      'AIから一回限りの実行確認が来たよ。',
      request.canAccept
        ? '表示内容は練習用ファイルだけを読むものです。許可は今回の一回に限られます。'
        : '読み取り専用の範囲内と確認できないため、許可はできません。',
    ]);
  }

  private applyChildStatus(
    observation: Extract<CodexObservation, { type: 'child-status' }>,
    operationId: string,
  ): void {
    this.codex = {
      ...this.codex,
      childStatus: observation.status,
      childExitCode: observation.exitCode ?? this.codex.childExitCode,
    };
    if (observation.status === 'closed') {
      const turnIsTerminal = ['completed', 'failed', 'interrupted'].includes(this.codex.turnStatus);
      if (!observation.expected && !turnIsTerminal) {
        this.status = 'unknown';
        this.phase = 'codex-unknown';
        this.codex = { ...this.codex, turnStatus: 'unknown' };
        this.currentWork = 'AIとの接続が予期せず終了しました。';
        this.changed = '接続終了の通知を受け取りましたが、作業完了は確認できていません。';
        this.decision = 'AIの作業結果は不明です。成功とは扱っていません。';
        this.record(operationId, 'codex-unknown', [
          this.evidence('owned-child', `専用Codex子プロセスがexitCode=${this.codex.childExitCode ?? '不明'}で終了しました。ターン完了通知はありません。`),
        ], [
          'AIとの接続が先に終わったよ。',
          '作業完了の通知を受け取る前なので、結果は不明です。',
        ]);
      } else {
        if (this.status === 'stopping' && this.codex.turnStatus === 'not-started') {
          this.status = 'stopped';
          this.phase = 'stopped';
          this.currentWork = 'AIへ作業を依頼する前に接続を終了しました。';
          this.changed = 'AIの作業が始まる前に停止したことを確認しました。';
          this.decision = '停止済みです。AIの作業は始まっていません。';
        } else if (this.status === 'finished' && this.codex.turnStatus === 'completed') {
          this.phase = 'finished';
          this.currentWork = 'AIの回答作業が終わり、AIとの接続終了も確認しました。';
          this.changed = '作業完了と接続終了を確認しました。';
          this.decision = 'AIとの接続終了を確認しました。AIの回答内容の正しさは別途確認してください。';
        } else if (this.status === 'interrupted' && this.codex.turnStatus === 'interrupted') {
          this.phase = 'codex-interrupted';
          this.currentWork = 'AIの作業停止と接続終了を確認しました。';
          this.changed = '作業停止と接続終了を別々に確認しました。';
          this.decision = 'AIの作業は中断しました。';
        } else if (this.status === 'failed' && this.codex.turnStatus === 'failed') {
          this.phase = 'codex-failed';
          this.currentWork = 'AIの作業失敗後、接続終了も確認しました。';
          this.changed = '作業の失敗と接続終了を確認しました。';
          this.decision = 'AIの作業は失敗しました。成功とは扱っていません。';
        }
        this.record(operationId, this.phase, [
          this.evidence('owned-child', `専用Codex子プロセスのcloseを観測しました。exitCode=${this.codex.childExitCode ?? '不明'}。`),
        ], [
          'AIとの接続が終わったよ。',
          '接続終了とAIの作業結果は別に記録します。',
        ]);
      }
      return;
    }
    if (observation.status === 'unknown') {
      this.status = 'unknown';
      if (!isTerminalTurnStatus(this.codex.turnStatus)) {
        this.phase = 'codex-unknown';
        this.codex = { ...this.codex, turnStatus: 'unknown' };
      }
      this.currentWork = isTerminalTurnStatus(this.codex.turnStatus)
        ? 'AIの作業結果は確認済みですが、接続状態は不明です。'
        : 'AIとの接続状態を確認できません。';
      this.changed = '接続状態が分かりません。';
      this.decision = isTerminalTurnStatus(this.codex.turnStatus)
        ? 'AIの作業結果と接続状態を分けて確認してください。'
        : 'AIの作業完了は確認できていません。';
      this.record(operationId, isTerminalTurnStatus(this.codex.turnStatus) ? this.phase : 'codex-unknown', [
        this.evidence('owned-child', '専用子プロセスの接続状態が不明です。'),
      ], [
        'AIとの接続状態が分からないよ。',
        '不明な状態を終了や成功として記録しません。',
      ]);
      return;
    }
    this.record(operationId, this.phase, [
      this.evidence('owned-child', `専用Codex子プロセスの状態を ${observation.status} と観測しました。`),
    ], [
      observation.status === 'starting' ? 'AIとの接続を準備しているよ。' : 'AIとの接続は動作中だよ。',
      'これはAIとの接続状態です。AIの作業状態とは別に記録します。',
    ]);
  }

  private matchesThreadTurn(threadId: string, turnId: string): boolean {
    if (this.codex.threadId !== threadId) return false;
    return this.codex.turnId === null || this.codex.turnId === turnId;
  }

  private isCurrentSession(sessionId: string): boolean {
    return sessionId === this.sessionId;
  }

  private record(operationId: string, phase: LabPhase, evidence: Evidence[], lines: [string, string]): void {
    this.phase = phase;
    this.generation += 1;
    this.updatedAt = new Date().toISOString();
    this.currentOperationId = operationId;
    const evidenceIds = evidence.map((item) => item.id);
    const sessionId = this.sessionId ?? 'session-not-started';
    const phaseLabel = codexPhaseLabel(phase);
    this.events.push({
      eventId: `codex-event-${this.generation}`,
      operationId,
      sequence: this.generation,
      sessionId,
      phase,
      phaseLabel,
      createdAt: this.updatedAt,
      evidence,
      dialogue: [
        { role: '実況', text: truncate(lines[0], 500), evidenceIds },
        { role: '解説', text: truncate(lines[1], 500), evidenceIds },
      ],
    });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.currentWork = truncate(this.currentWork, MAX_TEXT_CHARS);
    this.changed = truncate(this.changed, MAX_TEXT_CHARS);
    this.decision = truncate(this.decision, MAX_TEXT_CHARS);
  }

  private evidence(source: Evidence['source'], statement: string): Evidence {
    return { id: `codex-evidence-${this.generation + 1}-${randomUUID()}`, source, statement: truncate(statement, 1000) };
  }

  private nextOperationId(): string {
    this.operationSequence += 1;
    return `codex-op-${String(this.operationSequence).padStart(4, '0')}`;
  }

  private result(accepted: boolean, code: string, message: string, operationId: string): OperationResult {
    return { simulationOnly: false, accepted, code, message, operationId, snapshot: this.snapshot() };
  }
}

function isTerminal(status: LabStatus): boolean {
  return status === 'finished' || status === 'stopped' || status === 'failed' || status === 'interrupted';
}

function isTerminalTurnStatus(status: CodexRuntimeState['turnStatus']): boolean {
  return status === 'completed' || status === 'failed' || status === 'interrupted';
}

function describeItem(itemType: string): string {
  switch (itemType) {
    case 'commandExecution': return 'コマンド実行';
    case 'agentMessage': return '回答の作成';
    case 'reasoning': return '内部処理';
    default: return '作業項目';
  }
}

function codexPhaseLabel(phase: LabPhase): string {
  switch (phase) {
    case 'not-started': return '未開始';
    case 'codex-starting': return 'AIとの接続準備中';
    case 'codex-running': return 'AIが作業中';
    case 'approval': return 'AIからの確認待ち';
    case 'codex-stopping': return 'AIの停止を確認中';
    case 'codex-failed': return 'AIの作業に失敗';
    case 'codex-interrupted': return 'AIの作業停止を確認';
    case 'codex-unknown': return '状態不明';
    case 'finished': return 'AIの回答作業が完了';
    case 'stopped': return '停止済み';
    default: return phase;
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
