import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { LabSnapshot, OperationResult } from '../core.js';
import { createCompanionLabMcpServer } from '../mcp.js';
import { CompanionLabService } from '../core.js';
import { createCompanionLabService, type CompanionLabServiceLike } from '../service.js';
import { startHttpServer } from '../http.js';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

class CodexModeStub implements CompanionLabServiceLike {
  private readonly simulation = new CompanionLabService();
  private current: LabSnapshot = {
    ...this.simulation.snapshot(),
    simulationOnly: false,
    source: 'codex',
    capabilities: { start: true, advance: false, hold: false, humanDecision: true, stop: true },
    codex: {
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
    },
  };
  advanceCalls = 0;
  holdCalls = 0;

  snapshot(): LabSnapshot {
    return structuredClone(this.current);
  }

  start(expectedGeneration: number): OperationResult {
    if (expectedGeneration !== this.current.generation) return this.result(false, 'stale_generation', 'stale');
    this.current = {
      ...this.current,
      sessionId: 'shared-codex-session',
      generation: this.current.generation + 1,
      status: 'starting',
      phase: 'codex-starting',
      phaseLabel: 'Codex接続中',
      currentOperationId: 'codex-start',
      currentWork: 'Codex接続を準備しています。',
    };
    return this.result(true, 'started', 'started');
  }

  advance(): OperationResult {
    this.advanceCalls += 1;
    throw new Error('Codex mode must not call the fictional advance operation.');
  }

  hold(): OperationResult {
    this.holdCalls += 1;
    throw new Error('Codex mode must not call the fictional hold operation.');
  }

  stop(): OperationResult {
    return this.result(true, 'stop_requested', '停止を要求しました。');
  }

  decideFromHuman(): OperationResult {
    return this.result(true, 'approval_sent', '返答を送信しました。');
  }

  explain(detail = false) {
    return { simulationOnly: false, source: 'codex', summary: 'Codex summary', detail: detail ? 'Codex detail' : '', evidence: [], generation: this.current.generation };
  }

  summarize() {
    return { simulationOnly: false, source: 'codex', summary: 'Codex summary', generation: this.current.generation, eventCount: 0 };
  }

  private result(accepted: boolean, code: string, message: string): OperationResult {
    return {
      simulationOnly: false,
      accepted,
      code,
      message,
      operationId: 'codex-op',
      snapshot: this.snapshot(),
    };
  }
}

test('service source rejects unknown execution modes instead of falling back to simulation', () => {
  assert.equal(createCompanionLabService('simulation').snapshot().source, 'simulation');
  assert.throws(() => createCompanionLabService('simualtion'), /Invalid COMPANION_LAB_SOURCE/);
});

test('Codex mode HTTP and MCP share one non-simulation service and omit fictional controls', async (context) => {
  const lab = new CodexModeStub();
  const http = await startHttpServer(lab, { port: 0 });
  context.after(async () => http.close());

  const csrfResponse = await fetch(`${http.origin}/api/csrf`);
  const csrf = await csrfResponse.json() as { simulationOnly: boolean; csrfToken: string };
  assert.equal(csrf.simulationOnly, false);
  const cookie = csrfResponse.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie);

  const unknownPath = await fetch(`${http.origin}/no-such-page`);
  assert.equal(unknownPath.status, 404);
  assert.equal((await unknownPath.json() as { simulationOnly: boolean }).simulationOnly, false);

  const invalidInput = await fetch(`${http.origin}/api/start`, {
    method: 'POST',
    headers: {
      origin: http.origin,
      'sec-fetch-site': 'same-origin',
      cookie,
      'x-csrf-token': csrf.csrfToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expectedGeneration: 'zero' }),
  });
  assert.equal(invalidInput.status, 400);
  assert.equal((await invalidInput.json() as { simulationOnly: boolean }).simulationOnly, false);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createCompanionLabMcpServer(lab);
  const client = new Client({ name: 'codex-mode-io-test', version: '0.1.0' });
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    const toolNames = listed.tools.map(({ name }) => name).sort();
    assert.deepEqual(toolNames, [
      'explain_codex_companion_lab',
      'get_codex_companion_lab_state',
      'start_codex_companion_lab',
      'stop_codex_companion_lab',
      'summarize_codex_companion_lab',
    ]);
    assert.equal(toolNames.some((name) => /advance|hold|approve|decision/i.test(name)), false);

    const stateResult = await client.callTool({ name: 'get_codex_companion_lab_state', arguments: {} });
    const statePayload = stateResult.structuredContent as { simulationOnly: boolean; result: LabSnapshot };
    assert.equal(statePayload.simulationOnly, false);
    assert.equal(statePayload.result.simulationOnly, false);
    assert.equal(statePayload.result.source, 'codex');

    const startResult = await client.callTool({ name: 'start_codex_companion_lab', arguments: { expectedGeneration: 0 } });
    const started = startResult.structuredContent as { simulationOnly: boolean; result: OperationResult };
    assert.equal(started.simulationOnly, false);
    assert.equal(started.result.accepted, true);
    const uiState = await (await fetch(`${http.origin}/api/state`)).json() as LabSnapshot;
    assert.equal(uiState.simulationOnly, false);
    assert.equal(uiState.sessionId, started.result.snapshot.sessionId);
    assert.equal(uiState.generation, started.result.snapshot.generation);

    const advance = await fetch(`${http.origin}/api/advance`, {
      method: 'POST',
      headers: {
        origin: http.origin,
        'sec-fetch-site': 'same-origin',
        cookie,
        'x-csrf-token': csrf.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expectedGeneration: uiState.generation }),
    });
    assert.equal(advance.status, 409);
    assert.equal((await advance.json() as OperationResult).code, 'unsupported_capability');

    const hold = await fetch(`${http.origin}/api/hold`, {
      method: 'POST',
      headers: {
        origin: http.origin,
        'sec-fetch-site': 'same-origin',
        cookie,
        'x-csrf-token': csrf.csrfToken,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(hold.status, 409);
    assert.equal((await hold.json() as OperationResult).code, 'unsupported_capability');
    assert.equal(lab.advanceCalls, 0);
    assert.equal(lab.holdCalls, 0);
  } finally {
    await client.close();
    await mcpServer.close();
  }
});

test('SIGTERM on the stdio entry closes its shared HTTP listener', { timeout: 15000 }, async () => {
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/mcp-main.ts'], {
    cwd: appDir,
    env: {
      ...process.env,
      COMPANION_LAB_PORT: String(port),
      COMPANION_LAB_SOURCE: 'simulation',
      CI: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  let readyResolver: (() => void) | undefined;
  let readyRejecter: ((error: Error) => void) | undefined;
  let ready = false;
  const readySignal = new Promise<void>((resolveReady, rejectReady) => {
    readyResolver = resolveReady;
    readyRejecter = rejectReady;
  });
  const onStderr = (chunk: string) => {
    stderr += chunk;
    if (stderr.includes('stdio MCPで起動しました')) {
      ready = true;
      readyResolver?.();
    }
  };
  child.stderr.setEncoding('utf8').on('data', onStderr);
  const exitBeforeReady = (code: number | null, signal: NodeJS.Signals | null) => {
    if (!ready) readyRejecter?.(new Error(`stdio launcher exited before startup (code=${code}, signal=${signal}). stderr: ${stderr}`));
  };
  child.once('exit', exitBeforeReady);
  const readyTimeout = setTimeout(() => readyRejecter?.(new Error(`stdio launcher did not start. stderr: ${stderr}`)), 5000);

  try {
    await readySignal;
    clearTimeout(readyTimeout);
    assert.equal((await fetch(`${origin}/api/state`)).status, 200);
    child.kill('SIGTERM');
    const exit = await waitForChildExit(child, 5000);
    assert.equal(exit.code, 0, `launcher should exit cleanly after SIGTERM; stderr: ${stderr}`);
    assert.equal(stdout, '', 'the public MCP command must keep stdout reserved for protocol messages');
    await assert.rejects(fetch(`${origin}/api/state`), /fetch failed|ECONNREFUSED/);
  } finally {
    clearTimeout(readyTimeout);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await waitForChildExit(child, 3000).catch(() => undefined);
    }
  }
});

const uiNodeIds = [
    'phase', 'current-work', 'changed', 'decision', 'announcement', 'transcript', 'detail',
    'page-title', 'mode-banner', 'codex-state-panel', 'turn-status', 'child-status', 'stop-requested', 'model', 'final-report',
    'approval-panel', 'approval-heading', 'approval-title', 'approval-details', 'approval-state',
    'approval-preview-block', 'approval-preview', 'approval-blocked-reason',
    'controls-heading',
    'session-id', 'generation', 'operation-id', 'evidence',
    'start', 'advance', 'read-again', 'more-detail', 'speech-stop', 'approve', 'reject', 'hold', 'stop-work',
    'single-key-toggle', 'auto-voice-toggle', 'speak-detail-toggle',
];

function createUiHarness(
  scriptSource: string,
  initialSnapshot: LabSnapshot,
  explainPayload: Record<string, unknown>,
  options: { deferExplain?: boolean } = {},
) {
    let currentSnapshot = structuredClone(initialSnapshot);
    let pollShouldFail = false;
    let pollCallback: (() => Promise<void>) | null = null;
    let pendingExplain: (() => void) | null = null;
    const announcements: string[] = [];
    const spoken: string[] = [];
    const posted: Array<{ path: string; body: unknown }> = [];
    let speechCancels = 0;

    class FakeElement {
      id: string;
      tagName = 'DIV';
      textContent = '';
      hidden = false;
      disabled = false;
      checked = false;
      isContentEditable = false;
      parent: FakeElement | null = null;
      children: FakeElement[] = [];
      readonly attributes = new Map<string, string>();
      readonly listeners = new Map<string, Array<() => Promise<void> | void>>();

      constructor(id: string) {
        this.id = id;
      }

      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      }

      getAttribute(name: string) {
        return this.attributes.get(name) ?? null;
      }

      addEventListener(type: string, listener: () => Promise<void> | void) {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
      }

      async click() {
        for (const listener of this.listeners.get('click') ?? []) {
          await listener();
        }
      }

      async change() {
        for (const listener of this.listeners.get('change') ?? []) {
          await listener();
        }
      }

      replaceChildren() {
        this.children = [];
      }

      append(...items: FakeElement[]) {
        for (const item of items) item.parent = this;
        this.children.push(...items);
      }

      closest(selector: string): FakeElement | null {
        if (selector === '[hidden]') {
          let cursor: FakeElement | null = this;
          while (cursor) {
            if (cursor.hidden) return cursor;
            cursor = cursor.parent;
          }
          return null;
        }
        if (selector === '[contenteditable]') {
          let cursor: FakeElement | null = this;
          while (cursor) {
            if (cursor.attributes.has('contenteditable')) return cursor;
            cursor = cursor.parent;
          }
          return null;
        }
        return null;
      }

      focus() {
        document.activeElement = this;
      }

      blur() {
        if (document.activeElement === this) document.activeElement = document.body;
      }
    }

    const elements = new Map<string, FakeElement>(uiNodeIds.map((id) => [id, new FakeElement(id)]));
    elements.get('detail')!.hidden = true;
    const approvalPanel = elements.get('approval-panel')!;
    for (const id of ['approve', 'reject', 'hold']) {
      elements.get(id)!.parent = approvalPanel;
    }
    const announcementNode = elements.get('announcement')!;
    let announcementValue = '';
    Object.defineProperty(announcementNode, 'textContent', {
      get: () => announcementValue,
      set: (value: string) => {
        announcementValue = value;
        announcements.push(value);
      },
    });

    const documentListeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
    const document = {
      title: '',
      body: new FakeElement('body'),
      documentElement: new FakeElement('html'),
      activeElement: elements.get('advance') as FakeElement,
      getElementById: (id: string) => elements.get(id) ?? null,
      createElement: (tag: string) => new FakeElement(tag),
      addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
        const list = documentListeners.get(type) ?? [];
        list.push(listener);
        documentListeners.set(type, list);
      },
    };

    class FakeUtterance {
      text: string;
      lang = '';
      voice: { lang: string } | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    const windowObj = {
      setTimeout: (fn: () => Promise<void>) => {
        pollCallback = fn;
        return 1;
      },
      speechSynthesis: {
        speak: (utterance: FakeUtterance) => { spoken.push(utterance.text); },
        cancel: () => { speechCancels += 1; },
        getVoices: () => [] as Array<{ lang: string }>,
      },
      SpeechSynthesisUtterance: FakeUtterance,
    };

    const fetchFn = async (url: string, init?: { method?: string; body?: string }) => {
      if (url.startsWith('/api/') && init?.method === 'POST') {
        posted.push({ path: url, body: init.body ? JSON.parse(init.body) : null });
      }
      if (pollShouldFail) throw new Error('network error');
      if (url === '/api/csrf') {
        return { ok: true, json: async () => ({ csrfToken: 'csrf-token' }) };
      }
      if (url === '/api/state') {
        return { ok: true, json: async () => structuredClone(currentSnapshot) };
      }
      if (url === '/api/explain') {
        if (options.deferExplain) {
          return new Promise((resolveResponse) => {
            pendingExplain = () => resolveResponse({ ok: true, json: async () => structuredClone(explainPayload) });
          });
        }
        return { ok: true, json: async () => structuredClone(explainPayload) };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    vm.runInNewContext(scriptSource, {
      window: windowObj,
      document,
      fetch: fetchFn,
      SpeechSynthesisUtterance: FakeUtterance,
    });

    return {
      elements,
      document,
      announcements,
      spoken,
      posted,
      speechCancels: () => speechCancels,
      setSnapshot(next: LabSnapshot) {
        currentSnapshot = structuredClone(next);
      },
      setPollFailure(fail: boolean) {
        pollShouldFail = fail;
      },
      async poll() {
        if (pollCallback) await pollCallback();
      },
      async keydown(event: Record<string, unknown>) {
        for (const listener of documentListeners.get('keydown') ?? []) await listener(event);
      },
      async releaseExplain() {
        pendingExplain?.();
        pendingExplain = null;
        await new Promise((resolveTick) => setTimeout(resolveTick, 0));
      },
    };
}

test('UI script separates Codex and simulation controls, moves focus off hidden buttons, and announces concrete states without repeating unchanged polls', async () => {
  const scriptSource = await readFile(resolve(appDir, 'public/app.js'), 'utf8');

  const simulationLab = new CompanionLabService();
  const simHarness = createUiHarness(scriptSource, simulationLab.snapshot(), simulationLab.explain(true));
  await new Promise((resolveTick) => setTimeout(resolveTick, 10));
  assert.equal(simHarness.elements.get('controls-heading')?.textContent, 'デモの操作');
  assert.equal(simHarness.elements.get('start')?.textContent, '開始 / もう一度体験');
  assert.equal(simHarness.elements.get('advance')?.hidden, false);
  assert.equal(simHarness.elements.get('hold')?.hidden, false);

  const codexBase: LabSnapshot = {
    ...simulationLab.snapshot(),
    simulationOnly: false,
    source: 'codex',
    capabilities: { start: true, advance: false, hold: false, humanDecision: true, stop: true },
    status: 'not-started',
    phase: 'not-started',
    phaseLabel: '未開始',
    codex: {
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
    },
  };
  const codexExplain = {
    simulationOnly: false,
    source: 'codex',
    summary: 'AIから回答を受け取りました。内容の正しさは未確認です。AIとの接続は続いています。終了する場合は『Codex接続を停止』を選んでください。',
    detail: 'AIから回答を受け取りました。内容の正しさは未確認です。AIとの接続は続いています。終了する場合は『Codex接続を停止』を選んでください。',
    evidence: [{ id: 'codex-evidence-1', source: 'codex-app-server', statement: 'thread thread-1 のturn turn-1 が completed で完了しました。' }],
    generation: 2,
  };
  const codexHarness = createUiHarness(scriptSource, codexBase, codexExplain);
  await new Promise((resolveTick) => setTimeout(resolveTick, 10));

  assert.equal(codexHarness.elements.get('controls-heading')?.textContent, '作業の操作');
  assert.equal(codexHarness.elements.get('start')?.textContent, '練習タスクを開始');
  assert.equal(codexHarness.elements.get('advance')?.hidden, true);
  assert.equal(codexHarness.elements.get('advance')?.disabled, true);
  assert.equal(codexHarness.elements.get('hold')?.hidden, true);
  assert.equal(codexHarness.elements.get('hold')?.disabled, true);
  assert.equal(codexHarness.document.activeElement.id, 'start', 'focus must leave hidden advance button');

  const countBeforeUnchangedPoll = codexHarness.announcements.length;
  await codexHarness.poll();
  assert.equal(codexHarness.announcements.length, countBeforeUnchangedPoll, 'unchanged poll must not repeat announcement');

  codexHarness.setSnapshot({
    ...codexBase,
    generation: 1,
    status: 'running',
    phase: 'codex-running',
    phaseLabel: 'AIが作業中',
    currentWork: 'AIが練習用ファイルを読み取っています。',
    codex: { ...codexBase.codex!, childStatus: 'running', turnStatus: 'inProgress', threadId: 'thread-1', turnId: 'turn-1' },
  });
  await codexHarness.poll();
  assert.equal(codexHarness.elements.get('start')?.textContent, '練習タスクを実行中');

  codexHarness.setSnapshot({
    ...codexBase,
    generation: 2,
    status: 'finished',
    phase: 'finished',
    phaseLabel: 'AIの回答作業が完了',
    currentWork: 'AIの回答作業が完了しました。',
    codex: { ...codexBase.codex!, childStatus: 'running', turnStatus: 'completed', threadId: 'thread-1', turnId: 'turn-1', finalReport: '営業時間案内' },
    events: [{
      eventId: 'codex-event-2',
      operationId: 'codex-op-0002',
      sequence: 2,
      sessionId: 'session-1',
      phase: 'finished',
      phaseLabel: 'AIの回答作業が完了',
      createdAt: new Date().toISOString(),
      evidence: [{ id: 'codex-evidence-1', source: 'codex-app-server', statement: 'thread thread-1 のturn turn-1 が completed で完了しました。' }],
      dialogue: [
        { role: '実況', text: 'AIの回答作業が終わったよ。', evidenceIds: ['codex-evidence-1'] },
        { role: '解説', text: '作業完了を確認しました。', evidenceIds: ['codex-evidence-1'] },
      ],
    }],
  });
  await codexHarness.poll();
  assert.equal(codexHarness.elements.get('start')?.textContent, 'もう一度実行');
  assert.match(codexHarness.announcements.at(-1) ?? '', /AIから回答を受け取りました。内容の正しさは未確認で、Codexとの接続は続いています。/);

  await codexHarness.elements.get('more-detail')!.click();
  assert.equal(
    codexHarness.elements.get('detail')?.textContent,
    'AIから回答を受け取りました。内容の正しさは未確認です。AIとの接続は続いています。終了する場合は『Codex接続を停止』を選んでください。',
  );
  assert.doesNotMatch(codexHarness.elements.get('detail')?.textContent ?? '', /thread-1|turn-1/);
  assert.match(codexHarness.elements.get('evidence')?.textContent ?? '', /thread-1.*turn-1/);

  codexHarness.setPollFailure(true);
  await codexHarness.poll();
  assert.doesNotMatch(codexHarness.announcements.at(-1) ?? '', /デモ/);
  assert.match(codexHarness.announcements.at(-1) ?? '', /完了や終了したとは判断できません/);
});

function codexUiSnapshot(overrides: Partial<LabSnapshot> = {}): LabSnapshot {
  const base = new CompanionLabService().snapshot();
  return {
    ...base,
    simulationOnly: false,
    source: 'codex',
    sessionId: 'session-current',
    status: 'running',
    phase: 'codex-running',
    phaseLabel: 'AIが作業中',
    generation: 5,
    capabilities: { start: true, advance: false, hold: false, humanDecision: true, stop: true },
    currentWork: 'AIが練習用ファイルを読み取っています。',
    codex: {
      childStatus: 'running',
      childExitCode: null,
      threadId: 'thread-1',
      turnId: 'turn-1',
      turnStatus: 'inProgress',
      itemId: null,
      model: 'test-model',
      reasoningEffort: 'low',
      finalReport: null,
      stopRequested: false,
    },
    events: [{
      eventId: 'codex-event-5',
      operationId: 'codex-op-0005',
      sequence: 5,
      sessionId: 'session-current',
      phase: 'codex-running',
      phaseLabel: 'AIが作業中',
      createdAt: '2026-01-01T00:00:00.000Z',
      evidence: [{
        id: 'codex-evidence-5',
        source: 'codex-app-server',
        statement: 'thread thread-1 のturn turn-1 を観測しました。',
      }],
      dialogue: [
        { role: '実況', text: '練習用ファイルを読み取り中だよ。', evidenceIds: ['codex-evidence-5'] },
        { role: '解説', text: '結果はまだ未確認です。', evidenceIds: ['codex-evidence-5'] },
      ],
    }],
    ...overrides,
  };
}

const explainFixture = {
  simulationOnly: false,
  source: 'codex',
  summary: '説明の要約です。',
  detail: 'AIから回答を受け取りました。内容の正しさは未確認です。',
  evidence: [],
  generation: 5,
};

function uiTick(ms = 10): Promise<void> {
  return new Promise((resolveTick) => setTimeout(resolveTick, ms));
}

function workOperations(harness: { posted: Array<{ path: string }> }): string[] {
  return harness.posted
    .map((entry) => entry.path)
    .filter((path) => ['/api/start', '/api/stop', '/api/decision', '/api/advance', '/api/hold'].includes(path));
}

test('voice and single-key settings are present in the markup and off by default', async () => {
  const html = await readFile(resolve(appDir, 'public/index.html'), 'utf8');
  for (const id of ['single-key-toggle', 'auto-voice-toggle', 'speak-detail-toggle']) {
    const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
    assert.ok(input, `${id} must exist`);
    assert.match(input[0], /type="checkbox"/);
    assert.doesNotMatch(input[0], /\bchecked\b/, `${id} must start unchecked`);
  }
  assert.match(html, /単一キー操作と自動読み上げは初期状態ではオフです/);
  assert.match(html, /VoiceOver等との併用時の動作は未確認/);
  assert.match(html, /音声を止めても、AIの作業やCodexとの接続は止まりません/);
  assert.match(html, /開始・承認・拒否・作業停止・次へ進む・保留は単一キーでは実行しません/);
});

test('single-key controls are opt-in, guarded, and never run work operations', async () => {
  const scriptSource = await readFile(resolve(appDir, 'public/app.js'), 'utf8');
  const harness = createUiHarness(scriptSource, codexUiSnapshot(), explainFixture);
  await uiTick();
  const singleKey = harness.elements.get('single-key-toggle')!;
  const detail = harness.elements.get('detail')!;

  assert.equal(singleKey.checked, false);
  await harness.keydown({ key: 'j' });
  assert.equal(harness.spoken.length, 0, 'shortcuts must stay off by default');

  singleKey.checked = true;
  await singleKey.change();
  assert.match(harness.announcements.at(-1) ?? '', /単一キー操作を有効/);

  await harness.keydown({ key: 'j' });
  assert.match(harness.spoken.join('\n'), /実況役。練習用ファイルを読み取り中だよ。/);

  await harness.keydown({ key: 'k' });
  await uiTick();
  assert.match(detail.textContent, /AIから回答を受け取りました/);
  assert.equal(detail.hidden, false);

  await harness.keydown({ key: 'h' });
  const help = harness.announcements.at(-1) ?? '';
  assert.match(help, /jキー/);
  assert.match(help, /kキー/);
  assert.match(help, /Escapeキー/);
  assert.match(help, /単一キーでは実行しません/);
  assert.equal(harness.elements.get('auto-voice-toggle')!.checked, false,
    'the h guide must not depend on the automatic voice setting');
  assert.match(harness.spoken.at(-1) ?? '', /いま使える操作は.*単一キーでは実行しません/,
    'the h guide must be spoken even when automatic voice is off');

  const spokenBeforeEscape = harness.spoken.length;
  const cancelsBeforeEscape = harness.speechCancels();
  await harness.keydown({ key: 'Escape' });
  assert.match(harness.announcements.at(-1) ?? '', /音声を止めました/);
  assert.match(harness.announcements.at(-1) ?? '', /止まっていません/);
  assert.equal(harness.speechCancels(), cancelsBeforeEscape + 1);
  assert.equal(harness.spoken.length, spokenBeforeEscape, 'stopping speech must not start new speech');

  const guarded: Array<Record<string, unknown>> = [
    { key: 'j', repeat: true },
    { key: 'j', isComposing: true },
    { key: 'j', keyCode: 229 },
    { key: 'j', ctrlKey: true },
    { key: 'j', metaKey: true },
    { key: 'j', altKey: true },
    { key: 'j', shiftKey: true },
    { key: 'j', defaultPrevented: true },
    { key: 'j', target: { tagName: 'INPUT' } },
    { key: 'j', target: { tagName: 'TEXTAREA' } },
    { key: 'j', target: { tagName: 'SELECT' } },
    { key: 'j', target: { getAttribute: (name: string) => name === 'contenteditable' ? 'true' : null } },
    { key: 'j', target: { tagName: 'DIV', isContentEditable: true } },
  ];
  for (const event of guarded) {
    const before: number = harness.spoken.length;
    await harness.keydown(event);
    assert.equal(harness.spoken.length, before, `guard must block ${JSON.stringify(event)}`);
  }

  const editableAncestor = { getAttribute: (name: string) => name === 'contenteditable' ? 'true' : null };
  const nonEditableAncestor = { getAttribute: (name: string) => name === 'contenteditable' ? 'false' : null };
  const beforeEditableDescendant = harness.spoken.length;
  await harness.keydown({
    key: 'j',
    target: {
      tagName: 'SPAN',
      getAttribute: () => null,
      closest: (selector: string) => selector === '[contenteditable]' ? editableAncestor : null,
    },
  });
  assert.equal(harness.spoken.length, beforeEditableDescendant,
    'a descendant of a contenteditable element must block shortcuts');

  const beforeNonEditableAncestor = harness.spoken.length;
  await harness.keydown({
    key: 'j',
    target: {
      tagName: 'SPAN',
      getAttribute: () => null,
      closest: (selector: string) => selector === '[contenteditable]' ? nonEditableAncestor : null,
    },
  });
  assert.ok(harness.spoken.length > beforeNonEditableAncestor,
    'a contenteditable="false" ancestor must not block shortcuts');

  const beforeDirectFalse = harness.spoken.length;
  await harness.keydown({
    key: 'j',
    target: {
      tagName: 'DIV',
      getAttribute: (name: string) => name === 'contenteditable' ? 'false' : null,
      closest: () => null,
    },
  });
  assert.ok(harness.spoken.length > beforeDirectFalse,
    'contenteditable="false" itself is not an editable target');

  const cancelsBeforeInputEscape = harness.speechCancels();
  await harness.keydown({ key: 'Escape', target: { tagName: 'INPUT' } });
  assert.equal(harness.speechCancels(), cancelsBeforeInputEscape, 'Escape in an input keeps the browser default');

  const focusedInput = harness.elements.get('speak-detail-toggle')!;
  focusedInput.tagName = 'INPUT';
  harness.document.activeElement = focusedInput;
  const beforeFocused = harness.spoken.length;
  await harness.keydown({ key: 'j' });
  assert.equal(harness.spoken.length, beforeFocused, 'focus inside an input blocks shortcuts');
  harness.document.activeElement = harness.elements.get('advance')!;

  for (const key of ['s', 'a', 'r', 'n', 'Enter', ' ']) {
    await harness.keydown({ key });
  }
  assert.deepEqual(workOperations(harness), [], 'single keys must never start, approve, reject, or stop work');
  assert.ok(harness.posted.every((entry) => entry.path === '/api/explain'));

  singleKey.checked = false;
  await singleKey.change();
  const beforeDisabled = harness.spoken.length;
  await harness.keydown({ key: 'j' });
  assert.equal(harness.spoken.length, beforeDisabled, 'turning the toggle off disables shortcuts again');
  assert.match(harness.announcements.at(-1) ?? '', /単一キー操作を無効/);
});

test('auto voice is opt-in, speaks only confirmed changes, and separates work stop from connection close', async () => {
  const scriptSource = await readFile(resolve(appDir, 'public/app.js'), 'utf8');
  const base = codexUiSnapshot();
  const interrupted = codexUiSnapshot({
    generation: 6,
    status: 'interrupted',
    phase: 'codex-interrupted',
    phaseLabel: 'AIの作業停止を確認',
    codex: { ...base.codex!, turnStatus: 'interrupted' },
  });

  const offHarness = createUiHarness(scriptSource, base, explainFixture);
  await uiTick();
  assert.equal(offHarness.elements.get('auto-voice-toggle')!.checked, false);
  offHarness.setSnapshot(interrupted);
  await offHarness.poll();
  assert.equal(offHarness.spoken.length, 0, 'auto voice must stay silent while off');

  const harness = createUiHarness(scriptSource, base, explainFixture);
  await uiTick();
  const autoVoice = harness.elements.get('auto-voice-toggle')!;
  autoVoice.checked = true;
  await autoVoice.change();
  assert.equal(harness.spoken.length, 0, 'enabling auto voice must not replay the current state');
  assert.match(harness.announcements.at(-1) ?? '', /自動読み上げを有効/);

  harness.setSnapshot(interrupted);
  await harness.poll();
  assert.match(harness.spoken.at(-1) ?? '', /AIの作業停止を確認しました。Codex接続は続いています。/);

  const afterWorkStop = harness.spoken.length;
  await harness.poll();
  assert.equal(harness.spoken.length, afterWorkStop, 'unchanged polls must not repeat auto voice');

  harness.setSnapshot(codexUiSnapshot({
    generation: 7,
    status: 'interrupted',
    phase: 'codex-interrupted',
    phaseLabel: 'AIの作業停止を確認',
    codex: { ...base.codex!, turnStatus: 'interrupted', childStatus: 'closed' },
  }));
  await harness.poll();
  assert.match(harness.spoken.at(-1) ?? '', /AIの作業停止とCodex接続の終了を確認しました。/);

  harness.setSnapshot(codexUiSnapshot({
    generation: 8,
    codex: { ...base.codex!, childStatus: 'closed' },
  }));
  await harness.poll();
  assert.match(harness.spoken.at(-1) ?? '', /Codexとの接続終了を確認しました。AIの作業結果は未確認です。/);

  const beforeOff = harness.spoken.length;
  autoVoice.checked = false;
  await autoVoice.change();
  harness.setSnapshot(codexUiSnapshot({
    generation: 9,
    status: 'failed',
    phase: 'codex-failed',
    phaseLabel: 'AIの作業に失敗',
    codex: { ...base.codex!, turnStatus: 'failed' },
  }));
  await harness.poll();
  assert.equal(harness.spoken.length, beforeOff, 'turning auto voice off stops automatic reading');
});

test('auto voice describes finished and stopped states without confusing completion, connection end, and correctness', async () => {
  const scriptSource = await readFile(resolve(appDir, 'public/app.js'), 'utf8');
  const base = codexUiSnapshot();

  const readAfterChange = async (target: LabSnapshot, start: LabSnapshot = base): Promise<string> => {
    const harness = createUiHarness(scriptSource, start, explainFixture);
    await uiTick();
    const toggle = harness.elements.get('auto-voice-toggle')!;
    toggle.checked = true;
    await toggle.change();
    harness.setSnapshot(target);
    await harness.poll();
    return harness.spoken.at(-1) ?? '';
  };

  assert.equal(
    await readAfterChange(codexUiSnapshot({
      generation: 6,
      status: 'finished',
      phase: 'finished',
      phaseLabel: 'AIの回答作業が完了',
      codex: { ...base.codex!, turnStatus: 'completed' },
    })),
    'AIから回答を受け取りました。内容の正しさは未確認で、Codex接続は続いています。',
  );

  assert.equal(
    await readAfterChange(codexUiSnapshot({
      generation: 6,
      status: 'finished',
      phase: 'finished',
      phaseLabel: 'AIの回答作業が完了',
      codex: { ...base.codex!, turnStatus: 'completed', childStatus: 'closed' },
    })),
    'AIの回答完了とCodex接続の終了を確認しました。内容の正しさは未確認です。',
  );

  assert.equal(
    await readAfterChange(codexUiSnapshot({
      generation: 6,
      status: 'finished',
      phase: 'finished',
      phaseLabel: 'AIの回答作業が完了',
      codex: { ...base.codex!, turnStatus: 'completed', stopRequested: true },
    })),
    'AIから回答を受け取りました。内容の正しさは未確認で、Codexとの接続終了を確認しています。',
  );

  assert.equal(
    await readAfterChange(codexUiSnapshot({
      generation: 6,
      status: 'stopped',
      phase: 'stopped',
      phaseLabel: '停止済み',
      codex: { ...base.codex!, turnStatus: 'not-started', childStatus: 'closed', stopRequested: true },
    })),
    '作業開始前に停止し、Codex接続の終了を確認しました。',
  );

  const simulationBase = new CompanionLabService().snapshot();
  assert.equal(
    await readAfterChange(
      { ...simulationBase, generation: simulationBase.generation + 1, status: 'finished', phaseLabel: 'デモ終了' },
      simulationBase,
    ),
    'デモが終了しました。',
  );
  assert.equal(
    await readAfterChange(
      { ...simulationBase, generation: simulationBase.generation + 1, status: 'stopped', phaseLabel: '停止済み' },
      simulationBase,
    ),
    '体験デモを停止しました。',
  );

  const finishedMessage = await readAfterChange(codexUiSnapshot({
    generation: 6,
    status: 'finished',
    phase: 'finished',
    codex: { ...base.codex!, turnStatus: 'completed' },
  }));
  assert.doesNotMatch(finishedMessage, /回答作業が完了しました/);
  assert.match(finishedMessage, /内容の正しさは未確認/);
});

test('detail speech is opt-in and late responses are dropped after speech stop or a session change', async () => {
  const scriptSource = await readFile(resolve(appDir, 'public/app.js'), 'utf8');

  const harness = createUiHarness(scriptSource, codexUiSnapshot(), explainFixture);
  await uiTick();
  const speakDetail = harness.elements.get('speak-detail-toggle')!;
  assert.equal(speakDetail.checked, false);
  await harness.elements.get('more-detail')!.click();
  assert.match(harness.elements.get('detail')!.textContent, /AIから回答を受け取りました/);
  assert.equal(harness.spoken.length, 0, 'detail speech must stay off by default');

  speakDetail.checked = true;
  await speakDetail.change();
  await harness.elements.get('more-detail')!.click();
  assert.match(harness.spoken.at(-1) ?? '', /AIから回答を受け取りました/);

  const deferred = createUiHarness(scriptSource, codexUiSnapshot(), explainFixture, { deferExplain: true });
  await uiTick();
  const deferredToggle = deferred.elements.get('speak-detail-toggle')!;
  deferredToggle.checked = true;
  await deferredToggle.change();
  const pendingAfterStop = deferred.elements.get('more-detail')!.click();
  await deferred.elements.get('speech-stop')!.click();
  await deferred.releaseExplain();
  await pendingAfterStop;
  assert.equal(deferred.elements.get('detail')!.textContent, '', 'a response after speech stop must not be displayed');
  assert.equal(deferred.elements.get('detail')!.hidden, true);
  assert.equal(deferred.spoken.length, 0, 'a response after speech stop must not be spoken');
  assert.deepEqual(workOperations(deferred), [], 'stopping speech must not stop work or the connection');
  assert.equal(deferred.posted.some((entry) => entry.path === '/api/stop'), false);

  const generationChanged = createUiHarness(scriptSource, codexUiSnapshot(), explainFixture, { deferExplain: true });
  await uiTick();
  const pendingGeneration = generationChanged.elements.get('more-detail')!.click();
  generationChanged.setSnapshot(codexUiSnapshot({ generation: 6 }));
  await generationChanged.poll();
  await generationChanged.releaseExplain();
  await pendingGeneration;
  assert.equal(generationChanged.elements.get('detail')!.textContent, '');
  assert.equal(generationChanged.elements.get('detail')!.hidden, true);
  assert.equal(generationChanged.spoken.length, 0, 'a response for an old generation must be dropped');

  const sessionChanged = createUiHarness(scriptSource, codexUiSnapshot(), explainFixture, { deferExplain: true });
  await uiTick();
  const sessionToggle = sessionChanged.elements.get('speak-detail-toggle')!;
  sessionToggle.checked = true;
  await sessionToggle.change();
  const pendingSession = sessionChanged.elements.get('more-detail')!.click();
  sessionChanged.setSnapshot(codexUiSnapshot({ generation: 6, sessionId: 'session-other' }));
  await sessionChanged.poll();
  await sessionChanged.releaseExplain();
  await pendingSession;
  assert.equal(sessionChanged.elements.get('detail')!.textContent, '');
  assert.equal(sessionChanged.elements.get('detail')!.hidden, true);
  assert.equal(sessionChanged.spoken.length, 0, 'a response for an old session must be dropped');

  const toggledOffDuringRequest = createUiHarness(scriptSource, codexUiSnapshot(), explainFixture, { deferExplain: true });
  await uiTick();
  const onToggle = toggledOffDuringRequest.elements.get('speak-detail-toggle')!;
  onToggle.checked = true;
  await onToggle.change();
  const pendingOff = toggledOffDuringRequest.elements.get('more-detail')!.click();
  const cancelsBeforeOff = toggledOffDuringRequest.speechCancels();
  onToggle.checked = false;
  await onToggle.change();
  assert.equal(toggledOffDuringRequest.speechCancels(), cancelsBeforeOff + 1,
    'turning detail speech off cancels any playback in progress');
  await toggledOffDuringRequest.releaseExplain();
  await pendingOff;
  assert.equal(toggledOffDuringRequest.spoken.length, 0,
    'ON then request then OFF must not read the late response aloud');
  assert.match(toggledOffDuringRequest.elements.get('detail')!.textContent, /AIから回答を受け取りました/,
    'turning detail speech off keeps the late response visible on screen');

  const enabledDuringRequest = createUiHarness(scriptSource, codexUiSnapshot(), explainFixture, { deferExplain: true });
  await uiTick();
  const offToggle = enabledDuringRequest.elements.get('speak-detail-toggle')!;
  assert.equal(offToggle.checked, false);
  const pendingOn = enabledDuringRequest.elements.get('more-detail')!.click();
  offToggle.checked = true;
  await offToggle.change();
  await enabledDuringRequest.releaseExplain();
  await pendingOn;
  assert.equal(enabledDuringRequest.spoken.length, 0,
    'OFF then request then ON must not read the late response aloud');
  assert.match(enabledDuringRequest.elements.get('detail')!.textContent, /AIから回答を受け取りました/,
    'the late response may still be displayed when speech was not stopped');

  const toggledCycle = createUiHarness(scriptSource, codexUiSnapshot(), explainFixture, { deferExplain: true });
  await uiTick();
  const cycleToggle = toggledCycle.elements.get('speak-detail-toggle')!;
  cycleToggle.checked = true;
  await cycleToggle.change();
  const pendingCycle = toggledCycle.elements.get('more-detail')!.click();
  cycleToggle.checked = false;
  await cycleToggle.change();
  cycleToggle.checked = true;
  await cycleToggle.change();
  await toggledCycle.releaseExplain();
  await pendingCycle;
  assert.equal(toggledCycle.spoken.length, 0,
    'ON then request then OFF then ON must not read the old request aloud');
  assert.match(toggledCycle.elements.get('detail')!.textContent, /AIから回答を受け取りました/,
    'the old request stays on screen but is never spoken again');
});

async function unusedPort(): Promise<number> {
  const server = createNetServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  return address.port;
}

function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit);
      rejectExit(new Error(`Child process did not exit within ${timeoutMs}ms.`));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    };
    child.once('exit', onExit);
  });
}
