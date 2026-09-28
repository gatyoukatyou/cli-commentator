import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import type { CodexDecision } from './core.js';

const MAX_JSONL_LINE_BYTES = 1024 * 1024;
const MAX_PENDING_RPC = 8;
const MAX_PREVIEW_CHARS = 2000;
const RPC_TIMEOUT_MS = 15_000;
const TURN_TIMEOUT_MS = 180_000;
const CLOSE_TIMEOUT_MS = 3_000;

type RpcId = string | number;
type JsonObject = Record<string, unknown>;

export type CodexObservation =
  | { type: 'child-status'; status: 'starting' | 'running' | 'closing' | 'closed' | 'unknown'; exitCode?: number | null; expected?: boolean }
  | { type: 'thread-started'; threadId: string; model: string; reasoningEffort: string | null }
  | { type: 'turn-started'; threadId: string; turnId: string }
  | { type: 'item-started'; threadId: string; turnId: string; itemId: string; itemType: string; preview?: string }
  | { type: 'command-completed'; threadId: string; turnId: string; itemId: string; status: 'completed' | 'failed' | 'declined'; exitCode: number | null }
  | { type: 'agent-message-completed'; threadId: string; turnId: string; itemId: string; text: string; finalAnswer: boolean }
  | { type: 'turn-completed'; threadId: string; turnId: string; status: 'completed' | 'failed' | 'interrupted' }
  | { type: 'approval-response-sent'; approvalId: string; decision: CodexDecision }
  | { type: 'approval-revoked'; approvalId: string; reason: string }
  | { type: 'startup-stopped'; confirmedNoTurn: boolean }
  | { type: 'stop-unconfirmed'; reason: string }
  | { type: 'unsupported-request'; method: string }
  | { type: 'protocol-failure'; message: string };

export interface CodexApprovalRequest {
  approvalId: string;
  requestId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  title: string;
  preview: string;
  reason: string | null;
  canAccept: boolean;
  blockedReason: string | null;
}

export interface CodexClientObserver {
  onObservation(sessionId: string, observation: CodexObservation): void;
  onApproval(sessionId: string, approval: CodexApprovalRequest): void;
}

export interface CodexClientOptions {
  binary?: string;
  model?: string;
  reasoningEffort?: string;
  rpcTimeoutMs?: number;
  turnTimeoutMs?: number;
  closeTimeoutMs?: number;
}

interface PendingRpc {
  resolve(value: JsonObject): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface PendingApproval {
  approvalId: string;
  rawRequestId: RpcId;
  sessionId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  canAccept: boolean;
  responded: boolean;
}

interface RunContext {
  sessionId: string;
  observer: CodexClientObserver;
  stopped: boolean;
  startupStopEmitted: boolean;
  turnAttempted: boolean;
  turnStarted: boolean;
  turnCompleted: boolean;
  threadId: string | null;
  turnId: string | null;
  sampleRoot: string | null;
  samplePath: string | null;
  connection: JsonlConnection | null;
  blockedPrevious: RunContext | null;
  pendingApprovals: Map<string, PendingApproval>;
  turnCompletion: Promise<void>;
  resolveTurnCompletion(): void;
  closing: Promise<void> | null;
  childClosing: Promise<boolean> | null;
  expectedClose: boolean;
  fatal: boolean;
}

class JsonRpcFailure extends Error {}

/**
 * Owns app-server children created by this companion. It never attaches to the
 * user's desktop/task process and never writes the user's config.toml.
 */
export class CodexAppServerClient {
  private current: RunContext | null = null;
  private readonly binary: string;
  private readonly model: string | undefined;
  private readonly reasoningEffort: string | undefined;
  private readonly rpcTimeoutMs: number;
  private readonly turnTimeoutMs: number;
  private readonly closeTimeoutMs: number;

  constructor(options: CodexClientOptions = {}) {
    this.binary = options.binary ?? process.env.COMPANION_LAB_CODEX_BIN ?? 'codex';
    this.model = validateModel(options.model ?? process.env.COMPANION_LAB_CODEX_MODEL);
    this.reasoningEffort = validateEffort(options.reasoningEffort ?? process.env.COMPANION_LAB_CODEX_REASONING_EFFORT);
    this.rpcTimeoutMs = options.rpcTimeoutMs ?? RPC_TIMEOUT_MS;
    this.turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;
    this.closeTimeoutMs = options.closeTimeoutMs ?? CLOSE_TIMEOUT_MS;
  }

  start(sessionId: string, observer: CodexClientObserver): void {
    const previous = this.current;
    const context = createRunContext(sessionId, observer);
    context.blockedPrevious = previous;
    this.current = context;
    this.observe(context, { type: 'child-status', status: 'starting' });
    void this.run(context, previous).catch(() => {
      if (!context.stopped && !context.fatal && this.current === context) {
        context.fatal = true;
        this.observe(context, { type: 'protocol-failure', message: 'Codexとの接続または応答を確認できません。状態は不明です。' });
        this.observe(context, { type: 'child-status', status: 'unknown' });
      }
      void this.closeContext(context, true);
    });
  }

  respond(sessionId: string, approvalId: string, decision: CodexDecision): boolean {
    const context = this.current;
    const pending = context?.pendingApprovals.get(approvalId);
    if (
      !context
      || context.sessionId !== sessionId
      || !pending
      || pending.sessionId !== sessionId
      || pending.responded
      || (decision === 'accept' && !pending.canAccept)
      || !context.connection
    ) return false;

    const sent = context.connection.send({
      id: pending.rawRequestId,
      result: { decision },
    });
    if (!sent) return false;
    pending.responded = true;
    context.pendingApprovals.delete(approvalId);
    this.observe(context, { type: 'approval-response-sent', approvalId, decision });
    return true;
  }

  stop(sessionId: string): boolean {
    const context = this.current;
    if (!context || context.sessionId !== sessionId) return false;
    if (context.stopped) {
      if ((context.connection && !context.connection.isClosed && context.childClosing === null)
        || (context.blockedPrevious?.connection && !context.blockedPrevious.connection.isClosed && context.blockedPrevious.childClosing === null)) {
        context.closing = null;
        void this.stopContext(context);
        return true;
      }
      return context.closing !== null || context.childClosing !== null;
    }
    context.stopped = true;
    void this.stopContext(context);
    return true;
  }

  async close(): Promise<void> {
    const context = this.current;
    if (!context) return;
    if (!context.stopped) context.stopped = true;
    await this.stopContext(context);
  }

  private async run(context: RunContext, previous: RunContext | null): Promise<void> {
    if (previous) {
      const previousClosed = await this.closeContext(previous, true);
      if (!previousClosed) {
        this.observe(context, { type: 'protocol-failure', message: '前の専用Codex子プロセスの終了を確認できず、新しいタスクを開始しませんでした。' });
        this.observe(context, { type: 'child-status', status: 'unknown' });
        return;
      }
      context.blockedPrevious = null;
    }
    if (context.stopped) {
      this.emitStartupStopped(context, true);
      return;
    }

    const temporaryRoot = await mkdtemp(join(tmpdir(), 'companion-lab-codex-'));
    let sampleRoot: string;
    try {
      sampleRoot = await realpath(temporaryRoot);
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    context.sampleRoot = sampleRoot;
    context.samplePath = join(sampleRoot, 'sample.txt');
    await writeFile(context.samplePath, 'この架空サンプルでは、窓口の営業時間は平日9時から17時です。休業日は土曜日と日曜日です。\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    if (context.stopped) {
      this.emitStartupStopped(context, true);
      await this.cleanupSample(context);
      return;
    }

    // First child only reads the effective MCP server names. It does not start
    // a thread or execute a model turn, and its config payload is never logged.
    const discovery = await this.spawnConnection(context, [], false);
    const mcpNames = await this.discoverEnabledMcpNames(discovery);
    if (context.stopped) {
      await this.finishStartupStop(context, false);
      return;
    }
    context.expectedClose = true;
    await discovery.closeGracefully(this.closeTimeoutMs);
    if (!discovery.isClosed) throw new JsonRpcFailure('Codex discovery process did not close.');
    if (!context.stopped && !context.fatal) context.expectedClose = false;
    if (context.connection === discovery) context.connection = null;

    const main = await this.spawnConnection(context, mcpNames, true);
    if (context.stopped) {
      await this.finishStartupStop(context, true);
      return;
    }
    this.observe(context, { type: 'child-status', status: 'running' });
    const effective = await main.request('config/read', { includeLayers: false }, this.rpcTimeoutMs);
    verifyEffectiveSafetyConfig(effective, mcpNames);
    if (context.stopped) {
      await this.finishStartupStop(context, true);
      return;
    }

    const threadResponse = await main.request('thread/start', {
      ...(this.model ? { model: this.model } : {}),
      cwd: context.sampleRoot,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'read-only',
      ephemeral: true,
    }, this.rpcTimeoutMs);
    const thread = requireObject(threadResponse.thread);
    const threadId = requireString(thread.id);
    const cwd = requireString(threadResponse.cwd);
    const sandbox = requireObject(threadResponse.sandbox);
    const instructionSources = threadResponse.instructionSources;
    if (
      thread.ephemeral !== true
      || resolve(cwd) !== resolve(context.sampleRoot)
      || sandbox.type !== 'readOnly'
      || sandbox.networkAccess !== false
      || threadResponse.approvalPolicy !== 'on-request'
      || threadResponse.approvalsReviewer !== 'user'
      || !Array.isArray(instructionSources)
    ) {
      throw new JsonRpcFailure('Codex did not confirm the required isolated thread settings.');
    }
    context.threadId = threadId;
    const reportedModel = requireString(threadResponse.model);
    const reportedEffort = typeof threadResponse.reasoningEffort === 'string' ? threadResponse.reasoningEffort : null;
    this.observe(context, {
      type: 'thread-started',
      threadId,
      model: reportedModel,
      reasoningEffort: this.reasoningEffort ?? reportedEffort,
    });
    if (context.stopped) {
      await this.finishStartupStop(context, true);
      return;
    }

    context.turnAttempted = true;
    const turnResult = await main.request('turn/start', {
      threadId,
      input: [{
        type: 'text',
        text: '作業ディレクトリの sample.txt だけを読み、書かれた内容を日本語で2〜4文で説明してください。ほかのファイルを開かず、ファイル・設定・共有先を変更しないでください。',
      }],
      cwd: context.sampleRoot,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      ...(this.model ? { model: this.model } : {}),
      ...(this.reasoningEffort ? { effort: this.reasoningEffort } : {}),
    }, this.rpcTimeoutMs);
    const turn = requireObject(turnResult.turn);
    const turnId = requireString(turn.id);
    if (turn.status !== 'inProgress' && turn.status !== 'completed' && turn.status !== 'failed' && turn.status !== 'interrupted') {
      throw new JsonRpcFailure('Codex returned an unknown turn status.');
    }
    if (context.turnId !== null && context.turnId !== turnId) {
      throw new JsonRpcFailure('Codex returned a turn id that did not match its start notification.');
    }
    const alreadyStarted = context.turnStarted;
    context.turnId = turnId;
    context.turnStarted = true;
    if (!alreadyStarted && !context.stopped && !context.turnCompleted) {
      this.observe(context, { type: 'turn-started', threadId, turnId });
    }
    if (turn.status !== 'inProgress') {
      this.onTurnCompleted(context, { threadId, turnId, status: turn.status });
    }
    if (context.turnCompleted) return;
    if (context.stopped) {
      await context.turnCompletion;
      return;
    }

    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        context.turnCompletion,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new JsonRpcFailure('Codex turn timed out.')), this.turnTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async spawnConnection(context: RunContext, mcpNames: string[], active: boolean): Promise<JsonlConnection> {
    if (context.stopped) throw new JsonRpcFailure('Startup cancelled.');
    const connection = JsonlConnection.spawn(
      this.binary,
      buildAppServerArgs(mcpNames),
      context.sampleRoot ?? process.cwd(),
      safeChildEnvironment(),
      this.rpcTimeoutMs,
    );
    context.connection = connection;
    if (active) {
      connection.onMessage((message) => this.onMessage(context, message));
    }
    connection.onClosed((code) => {
      if (active) {
        this.onChildClosed(context, code);
        return;
      }
      const expected = context.stopped || context.expectedClose || context.fatal;
      if (this.current === context && context.connection === connection) context.connection = null;
      if (!expected) {
        context.fatal = true;
        this.observe(context, { type: 'child-status', status: 'closed', exitCode: code, expected: false });
        this.observe(context, { type: 'protocol-failure', message: '起動確認用の専用Codex子プロセスが予期せず終了しました。' });
        context.resolveTurnCompletion();
        void this.cleanupSample(context);
        return;
      }
      if (context.stopped || context.fatal) {
        this.observe(context, { type: 'child-status', status: 'closed', exitCode: code, expected: true });
        context.resolveTurnCompletion();
        void this.cleanupSample(context);
      }
    });
    connection.onFailure((message) => this.failContext(context, message));
    await connection.initialize(this.rpcTimeoutMs);
    return connection;
  }

  private async discoverEnabledMcpNames(connection: JsonlConnection): Promise<string[]> {
    const response = await connection.request('config/read', { includeLayers: false }, this.rpcTimeoutMs);
    const config = requireObject(response.config);
    const configured = config.mcp_servers;
    if (configured === undefined || configured === null) return [];
    const servers = requireObject(configured);
    const names: string[] = [];
    for (const [name, value] of Object.entries(servers)) {
      const entry = requireObject(value);
      if (entry.enabled !== false) names.push(name);
    }
    if (names.length > 100 || names.some((name) => !/^[A-Za-z0-9_-]{1,100}$/.test(name))) {
      throw new JsonRpcFailure('A configured MCP server name cannot be safely disabled with this Codex version.');
    }
    return names;
  }

  private onMessage(context: RunContext, message: JsonObject): void {
    if (this.current !== context || context.stopped && !context.turnId) return;
    try {
      if (typeof message.method === 'string') {
        if (Object.hasOwn(message, 'id')) this.onServerRequest(context, message);
        else this.onNotification(context, message);
        return;
      }
      if (Object.hasOwn(message, 'id')) return;
      throw new JsonRpcFailure('Unexpected JSON-RPC message shape.');
    } catch {
      this.failContext(context, 'Codexから予期しない形式の応答を受け取りました。状態は不明です。');
    }
  }

  private onNotification(context: RunContext, message: JsonObject): void {
    const method = requireString(message.method);
    const params = isRecord(message.params) ? message.params : {};
    if (method === 'thread/started') return;
    if (method === 'thread/closed' || method === 'thread/deleted') {
      const threadId = typeof params.threadId === 'string' ? params.threadId : null;
      if (threadId === context.threadId && !context.turnCompleted) {
        this.failContext(context, 'Codexスレッドがターン完了前に終了しました。状態は不明です。');
      }
      return;
    }
    if (method === 'turn/started') {
      const turn = requireObject(params.turn);
      const threadId = requireString(params.threadId);
      const turnId = requireString(turn.id);
      if ((context.threadId && threadId !== context.threadId) || context.stopped || context.turnCompleted) return;
      if (!context.turnId) {
        context.threadId = threadId;
        context.turnId = turnId;
        context.turnStarted = true;
        this.observe(context, { type: 'turn-started', threadId, turnId });
      }
      return;
    }
    if (method === 'item/started' || method === 'item/completed') {
      const item = requireObject(params.item);
      const threadId = requireString(params.threadId);
      const turnId = requireString(params.turnId);
      const itemId = requireString(item.id);
      if (!this.isCurrentTurn(context, threadId, turnId)) return;
      if (method === 'item/started') {
        if (!['commandExecution', 'agentMessage', 'reasoning', 'plan', 'userMessage'].includes(String(item.type))) {
          this.failContext(context, '固定の読取タスクにないCodex作業項目を検出しました。状態は不明です。');
          return;
        }
        const preview = item.type === 'commandExecution' && typeof item.command === 'string'
          ? safeCommandPreview(item.command)
          : undefined;
        this.observe(context, { type: 'item-started', threadId, turnId, itemId, itemType: requireString(item.type), ...(preview ? { preview } : {}) });
        return;
      }
      if (item.type === 'commandExecution') {
        if (item.status !== 'completed' && item.status !== 'failed' && item.status !== 'declined') {
          this.failContext(context, 'コマンド完了通知の状態が不明です。');
          return;
        }
        const exitCode = typeof item.exitCode === 'number' && Number.isInteger(item.exitCode) ? item.exitCode : null;
        this.observe(context, { type: 'command-completed', threadId, turnId, itemId, status: item.status, exitCode });
      } else if (item.type === 'agentMessage') {
        if (typeof item.text !== 'string') {
          this.failContext(context, 'Codex回答項目の形式が不明です。');
          return;
        }
        this.observe(context, {
          type: 'agent-message-completed',
          threadId,
          turnId,
          itemId,
          text: truncate(item.text, 4000),
          finalAnswer: item.phase === 'final_answer',
        });
      } else if (item.type === 'fileChange' || item.type === 'mcpToolCall') {
        this.observe(context, { type: 'protocol-failure', message: '読取だけの条件に含まれない作業項目を検出しました。実行結果は不明です。' });
        void this.closeContext(context, true);
      } else if (!['agentMessage', 'reasoning', 'plan', 'userMessage'].includes(String(item.type))) {
        this.failContext(context, '固定の読取タスクにない完了項目を検出しました。状態は不明です。');
      }
      return;
    }
    if (method === 'turn/completed') {
      const threadId = requireString(params.threadId);
      const turn = requireObject(params.turn);
      const turnId = requireString(turn.id);
      const status = turn.status;
      if (status !== 'completed' && status !== 'failed' && status !== 'interrupted') {
        throw new JsonRpcFailure('Unknown turn completion status.');
      }
      this.onTurnCompleted(context, { threadId, turnId, status });
      return;
    }
    if (method === 'serverRequest/resolved') {
      const requestId = params.requestId;
      if (!isRpcId(requestId)) throw new JsonRpcFailure('Resolved request id is invalid.');
      this.revokeResolvedApproval(context, requestId);
      return;
    }
    if (method === 'item/fileChange/patchUpdated'
      || method === 'item/commandExecution/terminalInteraction'
      || method === 'item/mcpToolCall/progress'
      || method === 'item/autoApprovalReview/started'
      || method === 'item/autoApprovalReview/completed'
      || method === 'autoApprovalReview/strictReviewRequired'
      || method === 'turn/diff/updated'
      || method === 'hook/started'
      || method === 'hook/completed') {
      this.failContext(context, '読取タスクに含まれないCodex通知を受信しました。状態は不明です。');
      return;
    }
    if (isKnownIgnoredNotification(method)) return;
    throw new JsonRpcFailure(`Unsupported notification: ${method}`);
  }

  private onServerRequest(context: RunContext, message: JsonObject): void {
    const method = requireString(message.method);
    const requestId = message.id;
    if (!isRpcId(requestId)) throw new JsonRpcFailure('Invalid server request id.');
    const params = requireObject(message.params);
    if (method !== 'item/commandExecution/requestApproval') {
      context.connection?.send({ id: requestId, error: { code: -32601, message: 'Unsupported request; cancelled by companion.' } });
      this.observe(context, { type: 'unsupported-request', method });
      return;
    }

    const threadId = requireString(params.threadId);
    const turnId = requireString(params.turnId);
    const itemId = requireString(params.itemId);
    if (context.stopped || context.turnCompleted || !context.turnStarted || !this.isCurrentTurn(context, threadId, turnId)) {
      context.connection?.send({ id: requestId, result: { decision: 'cancel' } });
      return;
    }
    if (context.pendingApprovals.size > 0) {
      context.connection?.send({ id: requestId, result: { decision: 'cancel' } });
      this.observe(context, { type: 'unsupported-request', method: 'parallel-approval-cancelled' });
      return;
    }

    const approvalId = randomUUID();
    const previewResult = makeApprovalPreview(params, context.sampleRoot, context.samplePath);
    const pending: PendingApproval = {
      approvalId,
      rawRequestId: requestId,
      sessionId: context.sessionId,
      threadId,
      turnId,
      itemId,
      canAccept: previewResult.canAccept,
      responded: false,
    };
    context.pendingApprovals.set(approvalId, pending);
    context.observer.onApproval(context.sessionId, {
      approvalId,
      requestId: String(requestId),
      threadId,
      turnId,
      itemId,
      title: previewResult.title,
      preview: previewResult.preview,
      reason: previewResult.reason,
      canAccept: previewResult.canAccept,
      blockedReason: previewResult.blockedReason,
    });
  }

  private onTurnCompleted(
    context: RunContext,
    completion: { threadId: string; turnId: string; status: 'completed' | 'failed' | 'interrupted' },
  ): void {
    if (!this.isCurrentTurn(context, completion.threadId, completion.turnId)) return;
    if (context.turnCompleted) return;
    this.cancelPendingApprovals(context, 'Codexターン完了により承認要求を終了しました。');
    context.turnCompleted = true;
    this.observe(context, { type: 'turn-completed', ...completion });
    context.resolveTurnCompletion();
  }

  private revokeResolvedApproval(context: RunContext, requestId: RpcId): void {
    for (const [approvalId, pending] of context.pendingApprovals) {
      if (pending.rawRequestId !== requestId) continue;
      context.pendingApprovals.delete(approvalId);
      this.observe(context, {
        type: 'approval-revoked',
        approvalId,
        reason: 'Codexが承認要求を終了しました。最新状態から再確認してください。',
      });
    }
  }

  private cancelPendingApprovals(context: RunContext, reason: string): void {
    for (const [approvalId, pending] of context.pendingApprovals) {
      context.pendingApprovals.delete(approvalId);
      const sent = !pending.responded && context.connection?.send({
        id: pending.rawRequestId,
        result: { decision: 'cancel' },
      });
      if (sent) {
        pending.responded = true;
        this.observe(context, { type: 'approval-response-sent', approvalId, decision: 'cancel' });
      } else {
        this.observe(context, { type: 'approval-revoked', approvalId, reason });
      }
    }
  }

  private revokeAllApprovals(context: RunContext, reason: string): void {
    for (const [approvalId] of context.pendingApprovals) {
      context.pendingApprovals.delete(approvalId);
      this.observe(context, { type: 'approval-revoked', approvalId, reason });
    }
  }

  private failContext(context: RunContext, message: string): void {
    if (context.fatal || context.connection?.isClosed) return;
    context.fatal = true;
    context.stopped = true;
    this.revokeAllApprovals(context, 'Codexとの接続に異常があり、承認を無効にしました。');
    this.observe(context, { type: 'protocol-failure', message });
    void this.closeContext(context, true);
  }

  private isCurrentTurn(context: RunContext, threadId: string, turnId: string): boolean {
    return context.threadId === threadId && (!context.turnId || context.turnId === turnId);
  }

  private onChildClosed(context: RunContext, code: number | null): void {
    const expected = context.stopped || context.expectedClose;
    this.cancelPendingApprovals(context, '専用Codex子プロセスが終了したため承認を無効にしました。');
    this.observe(context, {
      type: 'child-status',
      status: 'closed',
      exitCode: code,
      expected,
    });
    if (!expected && !context.turnCompleted && !context.fatal) {
      context.fatal = true;
      this.observe(context, { type: 'protocol-failure', message: 'Codex接続が予期せず終了しました。ターンの完了は確認できません。' });
    }
    if (this.current === context) context.connection = null;
    const waitingOwner = this.current;
    if (waitingOwner && waitingOwner !== context && waitingOwner.blockedPrevious === context) {
      waitingOwner.blockedPrevious = null;
      this.observe(waitingOwner, { type: 'child-status', status: 'closed', exitCode: code, expected });
    }
    context.resolveTurnCompletion();
    void this.cleanupSample(context);
  }

  private async stopContext(context: RunContext): Promise<void> {
    if (context.closing) return context.closing;
    context.closing = (async () => {
      const connection = context.connection;
      this.cancelPendingApprovals(context, 'Codexの停止要求により承認を取り消しました。');
      if (!connection && context.blockedPrevious) {
        const oldChildClosed = await this.closeContext(context.blockedPrevious, true);
        if (oldChildClosed) {
          context.blockedPrevious = null;
          this.observe(context, { type: 'child-status', status: 'closed', expected: true });
          if (!context.turnAttempted) this.emitStartupStopped(context, true);
        } else {
          this.observe(context, { type: 'stop-unconfirmed', reason: '前の専用Codex子プロセスが終了したことを確認できません。' });
        }
        return;
      }
      if (!connection) {
        const confirmedNoTurn = !context.turnAttempted;
        if (confirmedNoTurn) {
          await this.cleanupSample(context);
          this.emitStartupStopped(context, true);
        }
        else this.observe(context, { type: 'stop-unconfirmed', reason: 'Codexターン停止の確認前に接続がありません。' });
        return;
      }

      if (context.turnStarted && context.threadId && context.turnId && !context.turnCompleted) {
        this.observe(context, { type: 'child-status', status: 'closing' });
        try {
          await connection.request('turn/interrupt', { threadId: context.threadId, turnId: context.turnId }, this.rpcTimeoutMs);
          await withTimeout(context.turnCompletion, this.rpcTimeoutMs);
        } catch {
          if (!context.turnCompleted) {
            this.observe(context, { type: 'stop-unconfirmed', reason: 'interrupt応答またはinterrupted完了通知を確認できません。' });
          }
        }
      } else if (context.turnAttempted && !context.turnCompleted) {
        this.observe(context, { type: 'stop-unconfirmed', reason: 'turn/start後のターンIDと停止通知を確認できません。' });
      }

      const closed = await this.closeContext(context, !context.turnCompleted || !context.turnAttempted);
      if (!context.turnAttempted) {
        if (closed) this.emitStartupStopped(context, true);
        else this.observe(context, { type: 'stop-unconfirmed', reason: '準備用の専用Codexプロセスが終了したことを確認できません。' });
      }
    })();
    return context.closing;
  }

  private async closeContext(context: RunContext, force: boolean): Promise<boolean> {
    if (context.childClosing) return context.childClosing;
    context.expectedClose = true;
    context.childClosing = (async () => {
      const connection = context.connection;
      if (!connection) {
        await this.cleanupSample(context);
        return true;
      }
      this.observe(context, { type: 'child-status', status: 'closing' });
      try {
        if (force) await connection.terminate(this.closeTimeoutMs);
        else await connection.closeGracefully(this.closeTimeoutMs);
      } catch {
        if (!connection.isClosed) {
          this.observe(context, { type: 'protocol-failure', message: '専用Codex子プロセスの終了を確認できません。状態は不明です。' });
          context.childClosing = null;
          return false;
        }
      }
      if (!connection.isClosed) {
        this.observe(context, { type: 'protocol-failure', message: '専用Codex子プロセスの終了を確認できません。状態は不明です。' });
        context.childClosing = null;
        return false;
      }
      if (this.current === context) context.connection = null;
      await this.cleanupSample(context);
      return true;
    })();
    return context.childClosing;
  }

  private async finishStartupStop(context: RunContext, force: boolean): Promise<void> {
    const closed = await this.closeContext(context, force);
    if (closed) this.emitStartupStopped(context, true);
    else this.observe(context, { type: 'stop-unconfirmed', reason: '準備用の専用Codexプロセスが終了したことを確認できません。' });
  }

  private async cleanupSample(context: RunContext): Promise<void> {
    if (!context.sampleRoot) return;
    const root = context.sampleRoot;
    context.sampleRoot = null;
    context.samplePath = null;
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }

  private observe(context: RunContext, observation: CodexObservation): void {
    try {
      context.observer.onObservation(context.sessionId, observation);
    } catch {
      // Never let a consumer callback crash the owned protocol process.
    }
  }

  private emitStartupStopped(context: RunContext, confirmedNoTurn: boolean): void {
    if (context.startupStopEmitted) return;
    context.startupStopEmitted = true;
    this.observe(context, { type: 'startup-stopped', confirmedNoTurn });
  }
}

class JsonlConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<RpcId, PendingRpc>();
  private messageHandler: (message: JsonObject) => void = () => undefined;
  private closedHandler: (code: number | null) => void = () => undefined;
  private failureHandler: (message: string) => void = () => undefined;
  private buffer = '';
  private nextRequestId = 1;
  private closed = false;
  private failed = false;
  private stdinFailed = false;
  private closePromise: Promise<number | null>;
  private resolveClose!: (code: number | null) => void;

  static spawn(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, rpcTimeoutMs: number): JsonlConnection {
    const child = spawn(binary, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    return new JsonlConnection(child, rpcTimeoutMs);
  }

  private constructor(child: ChildProcessWithoutNullStreams, private readonly rpcTimeoutMs: number) {
    this.child = child;
    this.closePromise = new Promise((resolveClose) => { this.resolveClose = resolveClose; });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.readChunk(chunk));
    child.stderr.on('data', () => undefined); // Child stderr may contain private config or credentials.
    child.stdin.on('error', () => this.fail('Codex app-server input stream failed.'));
    child.once('error', () => this.fail('Codex app-server process failed.'));
    child.once('close', (code) => {
      this.closed = true;
      this.failPending('Codex app-server process closed.');
      this.resolveClose(code);
      this.closedHandler(code);
    });
  }

  onMessage(handler: (message: JsonObject) => void): void {
    this.messageHandler = handler;
  }

  onClosed(handler: (code: number | null) => void): void {
    this.closedHandler = handler;
  }

  onFailure(handler: (message: string) => void): void {
    this.failureHandler = handler;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async initialize(timeoutMs = this.rpcTimeoutMs): Promise<void> {
    const result = await this.request('initialize', {
      clientInfo: { name: 'cli-commentator-companion-lab', title: 'CLI Commentator Companion Lab', version: '0.2.0' },
      capabilities: {},
    }, timeoutMs);
    requireString(result.userAgent);
    requireString(result.codexHome);
    requireString(result.platformFamily);
    requireString(result.platformOs);
    if (!this.send({ method: 'initialized', params: {} })) throw new JsonRpcFailure('Could not complete app-server initialization.');
  }

  request(method: string, params: JsonObject, timeoutMs = this.rpcTimeoutMs): Promise<JsonObject> {
    if (this.closed || this.pending.size >= MAX_PENDING_RPC) return Promise.reject(new JsonRpcFailure('RPC is unavailable.'));
    const id = this.nextRequestId++;
    return new Promise((resolveResponse, rejectResponse) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectResponse(new JsonRpcFailure(`Timed out waiting for ${method}.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolveResponse,
        reject: rejectResponse,
        timer,
      });
      if (!this.send({ method, id, params })) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectResponse(new JsonRpcFailure('Could not write an app-server request.'));
      }
    });
  }

  send(message: JsonObject): boolean {
    if (this.closed || this.stdinFailed || !this.child.stdin.writable || this.child.stdin.destroyed) return false;
    try {
      // `write() === false` means the data was buffered. It is still queued and
      // must not be retried because requests carry one-shot identifiers.
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  async closeGracefully(timeoutMs: number): Promise<number | null> {
    if (this.closed) return this.closePromise;
    try {
      this.child.stdin.end();
      return await this.waitClose(timeoutMs);
    } catch {
      return this.terminate(timeoutMs);
    }
  }

  async terminate(timeoutMs: number): Promise<number | null> {
    if (this.closed) return this.closePromise;
    this.child.kill('SIGTERM');
    try {
      return await this.waitClose(timeoutMs);
    } catch {
      if (!this.closed) this.child.kill('SIGKILL');
      return this.waitClose(timeoutMs);
    }
  }

  private async waitClose(timeoutMs: number): Promise<number | null> {
    if (this.closed) return this.closePromise;
    return withTimeout(this.closePromise, timeoutMs);
  }

  private readChunk(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) {
        if (Buffer.byteLength(this.buffer, 'utf8') > MAX_JSONL_LINE_BYTES) this.protocolError();
        return;
      }
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line, 'utf8') > MAX_JSONL_LINE_BYTES) {
        this.protocolError();
        return;
      }
      if (line.length === 0) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (!isRecord(value)) throw new JsonRpcFailure('JSON-RPC message is not an object.');
        this.dispatch(value);
      } catch {
        this.protocolError();
        return;
      }
    }
  }

  private dispatch(message: JsonObject): void {
    if (Object.hasOwn(message, 'method')) {
      if (typeof message.method !== 'string') throw new JsonRpcFailure('JSON-RPC method is invalid.');
      this.messageHandler(message);
      return;
    }
    if (!isRpcId(message.id)) throw new JsonRpcFailure('JSON-RPC response id is invalid.');
    const pending = this.pending.get(message.id);
    if (!pending) throw new JsonRpcFailure('Unexpected JSON-RPC response id.');
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (isRecord(message.error)) {
      pending.reject(new JsonRpcFailure('Codex app-server returned an error response.'));
      return;
    }
    if (!isRecord(message.result)) {
      pending.reject(new JsonRpcFailure('Codex app-server returned an invalid result.'));
      return;
    }
    pending.resolve(message.result);
  }

  private protocolError(): void {
    this.fail('Malformed Codex JSONL response.');
  }

  private fail(message: string): void {
    if (this.failed || this.closed) return;
    this.failed = true;
    this.stdinFailed = true;
    this.failPending(message);
    this.failureHandler(message);
    void this.terminate(CLOSE_TIMEOUT_MS).catch(() => undefined);
  }

  private failPending(message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new JsonRpcFailure(message));
      this.pending.delete(id);
    }
  }
}

export function buildAppServerArgs(enabledMcpNames: string[]): string[] {
  const args = [
    'app-server', '--stdio',
    '--disable', 'hooks', '--disable', 'apps', '--disable', 'plugins', '--disable', 'multi_agent',
    '--enable', 'skip_host_skill_discovery',
    '--config', 'notify=[]',
    '--config', 'web_search="disabled"',
  ];
  for (const name of enabledMcpNames) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(name)) throw new JsonRpcFailure('Unsafe MCP config key.');
    args.push('--config', `mcp_servers.${name}.enabled=false`);
  }
  return args;
}

function verifyEffectiveSafetyConfig(response: JsonObject, expectedDisabledMcpNames: string[]): void {
  const config = requireObject(response.config);
  const features = isRecord(config.features) ? config.features : {};
  const notify = config.notify;
  const servers = config.mcp_servers;
  if (
    features.hooks !== false
    || features.apps !== false
    || features.plugins !== false
    || features.multi_agent !== false
    || features.skip_host_skill_discovery !== true
    || config.web_search !== 'disabled'
    || !Array.isArray(notify)
    || notify.length !== 0
  ) throw new JsonRpcFailure('Codex effective safety settings were not confirmed.');
  const mcpServers = servers === undefined || servers === null ? {} : requireObject(servers);
  for (const [name, value] of Object.entries(mcpServers)) {
    const entry = requireObject(value);
    if (entry.enabled !== false) throw new JsonRpcFailure('An MCP server remained enabled in effective settings.');
  }
  for (const name of expectedDisabledMcpNames) {
    const entry = requireObject(mcpServers[name]);
    if (entry.enabled !== false) throw new JsonRpcFailure('A configured MCP server was not disabled in effective settings.');
  }
}

function makeApprovalPreview(
  params: JsonObject,
  sampleRoot: string | null,
  samplePath: string | null,
): Pick<CodexApprovalRequest, 'title' | 'preview' | 'reason' | 'canAccept' | 'blockedReason'> {
  const command = typeof params.command === 'string' ? params.command : null;
  const cwd = typeof params.cwd === 'string' ? params.cwd : null;
  const reason = typeof params.reason === 'string' ? sanitizePreviewText(params.reason, 500) : null;
  const kind = params.kind === 'writeStdin' ? 'writeStdin' : params.kind === 'command' ? 'command' : null;
  const actions = Array.isArray(params.commandActions) ? params.commandActions.filter(isRecord) : [];
  const action = actions.length === 1 ? actions[0] : null;
  const actionPath = action && action.type === 'read' && typeof action.path === 'string' && cwd
    ? resolve(cwd, action.path)
    : null;
  const commandSafe = command !== null
    && command.length > 0
    && command.length <= MAX_PREVIEW_CHARS
    && !/[\u0000-\u001f\u007f]/.test(command)
    && !/(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/i.test(command);
  const expectedCommand = samplePath && !/[\\'\u0000-\u001f\u007f]/.test(samplePath)
    ? `cat '${samplePath}'`
    : null;
  const commandExact = expectedCommand !== null && command === expectedCommand;
  const actionExact = action !== null
    && action.type === 'read'
    && action.name === 'cat'
    && action.command === expectedCommand
    && typeof action.path === 'string'
    && actionPath === resolve(samplePath ?? '/invalid-sample-path');
  const execpolicyAmendmentAbsent = params.proposedExecpolicyAmendment == null;
  const networkAmendmentsAbsent = params.proposedNetworkPolicyAmendments == null
    || (Array.isArray(params.proposedNetworkPolicyAmendments) && params.proposedNetworkPolicyAmendments.length === 0);
  const canAccept = kind === 'command'
    && commandSafe
    && commandExact
    && cwd !== null
    && sampleRoot !== null
    && resolve(cwd) === resolve(sampleRoot)
    && samplePath !== null
    && actionExact
    && params.networkApprovalContext == null
    && execpolicyAmendmentAbsent
    && networkAmendmentsAbsent;
  const blockedReason = canAccept
    ? null
    : params.proposedExecpolicyAmendment != null || !networkAmendmentsAbsent
      ? '追加の許可ルールや通信許可を伴うため、承認できません。'
      : params.networkApprovalContext != null
        ? 'ネットワーク権限の要求は、この読取専用デモでは承認できません。'
      : kind !== 'command'
        ? 'コマンド実行の内容を確認できないため、承認できません。拒否または取消を選んでください。'
        : 'sample.txt だけを読む操作と確認できないため、承認できません。拒否または取消を選んでください。';
  const preview = [
    `種類: ${kind ?? '未対応'}`,
    `コマンド: ${commandSafe ? command : '表示できる安全なプレビューがありません'}`,
    `作業場所: ${cwd && !/[\u0000-\u001f\u007f]/.test(cwd) ? truncate(cwd, 500) : '確認できません'}`,
    `理由: ${reason || '説明なし'}`,
    '承認すると、read-only sandboxの範囲外でこの一回のコマンド実行を許可します。',
  ].join('\n');
  return {
    title: 'Codexのコマンド実行を確認',
    preview,
    reason,
    canAccept,
    blockedReason,
  };
}

function sanitizePreviewText(value: string, maxChars: number): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/i.test(normalized)) {
    return '機密らしい値を含むため理由を伏せました。';
  }
  return truncate(normalized, maxChars);
}

function safeChildEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowed = [
    'PATH', 'HOME', 'CODEX_HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
    'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  ];
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (!env.PATH) env.PATH = ['/usr/local/bin', '/usr/bin', '/bin'].join(delimiter);
  return env;
}

function validateModel(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)) throw new Error('Invalid trusted Codex model setting.');
  return value;
}

function validateEffort(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  if (!['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value)) {
    throw new Error('Invalid trusted Codex reasoning effort setting.');
  }
  return value;
}

function createRunContext(sessionId: string, observer: CodexClientObserver): RunContext {
  let resolveTurnCompletion!: () => void;
  const turnCompletion = new Promise<void>((resolvePromise) => { resolveTurnCompletion = resolvePromise; });
  return {
    sessionId,
    observer,
    stopped: false,
    startupStopEmitted: false,
    turnAttempted: false,
    turnStarted: false,
    turnCompleted: false,
    threadId: null,
    turnId: null,
    sampleRoot: null,
    samplePath: null,
    connection: null,
    blockedPrevious: null,
    pendingApprovals: new Map(),
    turnCompletion,
    resolveTurnCompletion,
    closing: null,
    childClosing: null,
    expectedClose: false,
    fatal: false,
  };
}

const KNOWN_IGNORED_NOTIFICATIONS = new Set([
  'thread/status/changed', 'thread/archived', 'thread/unarchived', 'thread/reverted', 'skills/changed',
  'thread/name/updated', 'thread/attachment/updated', 'thread/goal/updated', 'thread/goal/cleared',
  'thread/queue/changed', 'project/changed', 'thread/project/updated', 'thread/environment/connected',
  'thread/environment/disconnected', 'thread/settings/updated', 'thread/tokenUsage/updated', 'turn/plan/updated',
  'rawResponseItem/completed', 'rawResponse/completed', 'item/agentMessage/delta', 'item/plan/delta',
  'command/exec/outputDelta', 'process/outputDelta', 'process/exited', 'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta', 'mcpServer/oauthLogin/completed', 'mcpServer/startupStatus/updated',
  'mcpServer/event/stream/notification', 'account/updated', 'account/gatewayOAuth/changed',
  'account/rateLimits/updated', 'app/list/updated', 'remoteControl/status/changed',
  'externalAgentConfig/import/progress', 'externalAgentConfig/import/completed', 'fs/changed',
  'item/reasoning/summaryTextDelta', 'item/reasoning/summaryPartAdded', 'item/reasoning/textDelta',
  'thread/compacted', 'model/rerouted', 'model/verification', 'modelProvider/authRecoveryStarted',
  'modelProvider/authRecoveryCompleted', 'turn/moderationMetadata', 'model/safetyBuffering/updated',
  'warning', 'deprecationNotice', 'configWarning', 'fuzzyFileSearch/sessionUpdated', 'fuzzyFileSearch/sessionCompleted',
  'thread/realtime/started', 'thread/realtime/itemAdded', 'thread/realtime/item/started',
  'thread/realtime/item/transcript/delta', 'thread/realtime/item/completed', 'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done', 'thread/realtime/outputAudio/delta', 'thread/realtime/sdp',
  'thread/realtime/error', 'thread/realtime/closed', 'windows/worldWritableWarning',
  'windowsSandbox/setupCompleted', 'account/login/completed',
]);

function isKnownIgnoredNotification(method: string): boolean {
  return KNOWN_IGNORED_NOTIFICATIONS.has(method);
}

function safeCommandPreview(value: string): string {
  if (/(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/i.test(value)) {
    return 'コマンド内容は機密らしい値を含むため伏せました。';
  }
  return truncate(value, MAX_PREVIEW_CHARS);
}

function isRpcId(value: unknown): value is RpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown): JsonObject {
  if (!isRecord(value)) throw new JsonRpcFailure('Expected a JSON object.');
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new JsonRpcFailure('Expected a non-empty string.');
  return value;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new JsonRpcFailure('Timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
