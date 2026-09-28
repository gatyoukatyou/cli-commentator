import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
