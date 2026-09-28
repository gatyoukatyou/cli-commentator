import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  CodexAppServerClient,
  type CodexApprovalRequest,
  type CodexClientObserver,
  type CodexObservation,
} from '../codex-client.js';

const fixturePath = fileURLToPath(new URL('./fixtures/fake-codex-app-server.mjs', import.meta.url));

interface TraceEntry {
  pid: number;
  mode: string;
  discovery: boolean;
  type: string;
  method?: string;
  args?: string[];
  requestMethods?: string[];
  requestId?: string;
  decision?: string | null;
  error?: number | null;
}

class Recorder implements CodexClientObserver {
  readonly observations: Array<{ sessionId: string; observation: CodexObservation }> = [];
  readonly approvals: Array<{ sessionId: string; approval: CodexApprovalRequest }> = [];

  onObservation(sessionId: string, observation: CodexObservation): void {
    this.observations.push({ sessionId, observation });
  }

  onApproval(sessionId: string, approval: CodexApprovalRequest): void {
    this.approvals.push({ sessionId, approval });
  }
}

interface Harness {
  mode: string;
  client: CodexAppServerClient;
  recorder: Recorder;
  tracePath: string;
  readTrace(): Promise<TraceEntry[]>;
  close(): Promise<void>;
}

async function createHarness(
  mode: string,
  options: { rpcTimeoutMs?: number; closeTimeoutMs?: number } = {},
): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), 'companion-codex-client-test-'));
  const tracePath = join(directory, 'trace.jsonl');
  const wrapperPath = join(directory, 'codex-fixture');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(wrapperPath, [
    '#!/bin/sh',
    `exec ${quote(process.execPath)} ${quote(fixturePath)} ${quote(mode)} ${quote(tracePath)} "$@"`,
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o700 });
  await chmod(wrapperPath, 0o700);

  const client = new CodexAppServerClient({
    binary: wrapperPath,
    model: 'fixture-model',
    reasoningEffort: 'low',
    rpcTimeoutMs: options.rpcTimeoutMs ?? 5000,
    turnTimeoutMs: 12_000,
    closeTimeoutMs: options.closeTimeoutMs ?? 1000,
  });
  const recorder = new Recorder();
  let closed = false;
  const readTrace = async (): Promise<TraceEntry[]> => {
    let content: string;
    try {
      content = await readFile(tracePath, 'utf8');
    } catch (error) {
      // No fixture has written its initial launch record yet.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const lastNewline = content.lastIndexOf('\n');
    if (lastNewline < 0) return [];
    return content.slice(0, lastNewline)
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TraceEntry);
  };

  return {
    mode,
    client,
    recorder,
    tracePath,
    readTrace,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await client.close();
        const traces = await waitUntil(async () => {
          const entries = await readTrace();
          const launchPids = [...new Set(entries.filter((entry) => entry.type === 'launch').map((entry) => entry.pid))];
          if (launchPids.length === 0) return null;
          return launchPids.every((pid) => !isProcessAlive(pid)) ? true : null;
        }, 3000, `owned fake Codex child did not close for mode ${mode}`);
        assert.equal(traces, true, `owned fake Codex child did not close for mode ${mode}`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

async function withHarness(
  mode: string,
  body: (harness: Harness) => Promise<void>,
  options: { rpcTimeoutMs?: number; closeTimeoutMs?: number } = {},
): Promise<void> {
  const harness = await createHarness(mode, options);
  try {
    await body(harness);
  } finally {
    await harness.close();
  }
}

function start(harness: Harness, sessionId = `session-${harness.mode}`): string {
  harness.client.start(sessionId, harness.recorder);
  return sessionId;
}

async function waitForObservation(
  harness: Harness,
  predicate: (observation: CodexObservation) => boolean,
  timeoutMs = 8000,
): Promise<CodexObservation> {
  const found = await waitUntil(async () => harness.recorder.observations.find((item) => predicate(item.observation))?.observation ?? null, timeoutMs,
    `observation not received for ${harness.mode}: ${describeObservations(harness.recorder)}`);
  assert.ok(found);
  return found;
}

async function waitForApproval(harness: Harness, timeoutMs = 8000): Promise<CodexApprovalRequest> {
  const approval = await waitUntil(async () => harness.recorder.approvals[0]?.approval ?? null, timeoutMs,
    `approval not received for ${harness.mode}: ${describeObservations(harness.recorder)}`);
  assert.ok(approval);
  return approval;
}

async function waitForTrace(
  harness: Harness,
  predicate: (entries: TraceEntry[]) => boolean,
  timeoutMs = 3000,
): Promise<TraceEntry[]> {
  return waitUntil(async () => {
    const entries = await harness.readTrace();
    return predicate(entries) ? entries : null;
  }, timeoutMs, `trace condition not reached for ${harness.mode}`);
}

async function waitUntil<T>(read: () => Promise<T | null> | T | null, timeoutMs: number, message: string): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 15));
  }
  throw new Error(message);
}

function observations(harness: Harness, type: CodexObservation['type']): CodexObservation[] {
  return harness.recorder.observations
    .map((item) => item.observation)
    .filter((item) => item.type === type);
}

function describeObservations(recorder: Recorder): string {
  return recorder.observations.map(({ observation }) => observation.type).join(', ') || '(none)';
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

test('app-server JSONL handshake, safe effective config, and turn completion stay separate from child close', async () => {
  for (const mode of ['success', 'delayed-turn-result']) {
    await withHarness(mode, async (harness) => {
      const sessionId = start(harness);
      const completed = await waitForObservation(harness, (item) => item.type === 'turn-completed');
      assert.equal(completed.type, 'turn-completed');
      assert.equal(completed.status, 'completed');
      assert.equal(completed.turnId, 'turn-fixture-1');
      assert.equal(observations(harness, 'turn-started').length, 1, 'turn started is recorded once even when its RPC reply arrives late');
      assert.equal(observations(harness, 'agent-message-completed').length, 1);
      assert.equal(observations(harness, 'command-completed').length, 1);
      assert.equal(observations(harness, 'child-status').some((item) => item.type === 'child-status' && item.status === 'closed'), false,
        'a completed turn does not imply the owned child has exited');

      const trace = await waitForTrace(harness, (entries) => entries.filter((entry) => entry.type === 'launch').length === 2);
      const discovery = trace.find((entry) => entry.type === 'launch' && entry.discovery);
      const main = trace.find((entry) => entry.type === 'launch' && !entry.discovery);
      assert.ok(discovery);
      assert.ok(main);
      assert.ok(main.args?.includes('--stdio'));
      assert.ok(main.args?.includes('mcp_servers.openaiDeveloperDocs.enabled=false'));
      assert.ok(main.args?.includes('mcp_servers.node_repl.enabled=false'));
      assert.ok(main.args?.includes('mcp_servers.computer-use.enabled=false'));
      assert.ok(main.args?.includes('--disable') && main.args.includes('hooks'));
      assert.ok(main.args?.includes('notify=[]'));
      assert.ok(main.args?.includes('web_search="disabled"'));
      const methods = trace.filter((entry) => entry.type === 'request' && !entry.discovery).map((entry) => entry.method);
      assert.deepEqual(methods.slice(0, 5), ['initialize', 'initialized', 'config/read', 'thread/start', 'turn/start']);
      const turnStart = trace.find((entry) => entry.type === 'request' && entry.method === 'turn/start');
      assert.ok(turnStart?.args?.includes('--enable'));
      assert.equal(sessionId, `session-${mode}`);

      assert.equal(harness.client.stop(sessionId), true);
      await waitForObservation(harness, (item) => item.type === 'child-status' && item.status === 'closed');
      assert.equal(observations(harness, 'turn-completed').length, 1);
    });
  }
});

test('one-shot approval, unsafe preview, resolved and parallel requests, plus unsupported requests fail closed', async () => {
  await withHarness('approval', async (harness) => {
    const sessionId = start(harness);
    const approval = await waitForApproval(harness);
    assert.equal(approval.canAccept, true, JSON.stringify(approval));
    assert.match(approval.preview, /sample\.txt/);
    assert.equal(harness.client.respond('another-session', approval.approvalId, 'accept'), false);
    assert.equal(harness.client.respond(sessionId, approval.approvalId, 'accept'), true);
    assert.equal(harness.client.respond(sessionId, approval.approvalId, 'accept'), false, 'approval cannot be replayed');
    await waitForObservation(harness, (item) => item.type === 'turn-completed');
    const command = observations(harness, 'command-completed').find((item) => item.type === 'command-completed');
    assert.equal(command?.type === 'command-completed' ? command.status : null, 'completed');
    const response = (await waitForTrace(harness, (entries) => entries.some((entry) => entry.type === 'approval-response')))
      .find((entry) => entry.type === 'approval-response');
    assert.equal(response?.decision, 'accept');
  });

  await withHarness('unsafe-approval', async (harness) => {
    const sessionId = start(harness);
    const approval = await waitForApproval(harness);
    assert.equal(approval.canAccept, false);
    assert.match(approval.blockedReason ?? '', /sample\.txt/);
    assert.equal(harness.client.respond(sessionId, approval.approvalId, 'accept'), false);
    assert.equal(harness.client.respond(sessionId, approval.approvalId, 'decline'), true);
    await waitForObservation(harness, (item) => item.type === 'turn-completed');
    const declined = observations(harness, 'command-completed').find((item) => item.type === 'command-completed');
    assert.equal(declined?.type === 'command-completed' ? declined.status : null, 'declined');
    assert.equal(declined?.type === 'command-completed' ? declined.exitCode : -1, null,
      'declined must not look like an executed command with a successful exit code');
  });

  await withHarness('resolved-approval', async (harness) => {
    const sessionId = start(harness);
    const approval = await waitForApproval(harness);
    await waitForObservation(harness, (item) => item.type === 'approval-revoked');
    assert.equal(harness.client.respond(sessionId, approval.approvalId, 'accept'), false,
      'serverRequest/resolved invalidates a stale UI approval');
    const completion = await waitForObservation(harness, (item) => item.type === 'turn-completed');
    assert.equal(completion.type, 'turn-completed');
    assert.equal(completion.status, 'failed');
  });

  await withHarness('parallel-approval', async (harness) => {
    const sessionId = start(harness);
    const first = await waitForApproval(harness);
    await waitForObservation(harness, (item) => item.type === 'unsupported-request' && item.method === 'parallel-approval-cancelled');
    await waitForTrace(harness, (entries) => entries.some((entry) => entry.type === 'approval-response' && entry.requestId === 'approval-request-2'));
    assert.equal(harness.recorder.approvals.length, 1, 'a second pending approval is cancelled instead of replacing the first');
    assert.equal(harness.client.respond(sessionId, first.approvalId, 'decline'), true);
    await waitForObservation(harness, (item) => item.type === 'turn-completed');
  });

  await withHarness('unknown-request', async (harness) => {
    start(harness);
    await waitForObservation(harness, (item) => item.type === 'unsupported-request' && item.method === 'item/fileChange/requestApproval');
    const completion = await waitForObservation(harness, (item) => item.type === 'turn-completed');
    assert.equal(completion.type, 'turn-completed');
    assert.equal(completion.status, 'failed');
    const trace = await waitForTrace(harness, (entries) => entries.some((entry) => entry.type === 'unsupported-response'));
    assert.equal(trace.find((entry) => entry.type === 'unsupported-response')?.error, -32601);
  });
});

test('failed and declined command item statuses remain distinct from turn success', async () => {
  for (const [mode, expectedStatus, expectedExit] of [
    ['failed-command', 'failed', 17],
    ['declined-command', 'declined', null],
  ] as const) {
    await withHarness(mode, async (harness) => {
      start(harness);
      const item = await waitForObservation(harness, (observation) => observation.type === 'command-completed');
      assert.equal(item.type, 'command-completed');
      if (item.type === 'command-completed') {
        assert.equal(item.status, expectedStatus);
        assert.equal(item.exitCode, expectedExit);
      }
      const turn = await waitForObservation(harness, (observation) => observation.type === 'turn-completed');
      assert.equal(turn.type, 'turn-completed');
      assert.equal(turn.status, 'failed');
    });
  }
});

test('startup cancellation, interrupt confirmation, and interrupt acknowledgement are distinguished', async () => {
  await withHarness('slow-config', async (harness) => {
    const sessionId = start(harness);
    await waitForObservation(harness, (item) => item.type === 'child-status' && item.status === 'running');
    assert.equal(harness.client.stop(sessionId), true);
    const stopped = await waitForObservation(harness, (item) => item.type === 'startup-stopped');
    assert.equal(stopped.type, 'startup-stopped');
    assert.equal(stopped.confirmedNoTurn, true);
    assert.equal(observations(harness, 'turn-started').length, 0);
    assert.equal((await harness.readTrace()).some((entry) => entry.method === 'thread/start'), false);
  });

  await withHarness('interrupt-confirmed', async (harness) => {
    const sessionId = start(harness);
    await waitForObservation(harness, (item) => item.type === 'turn-started');
    assert.equal(harness.client.stop(sessionId), true);
    const stopped = await waitForObservation(harness, (item) => item.type === 'turn-completed');
    assert.equal(stopped.type, 'turn-completed');
    assert.equal(stopped.status, 'interrupted');
    await waitForObservation(harness, (item) => item.type === 'child-status' && item.status === 'closed');
    assert.equal(observations(harness, 'stop-unconfirmed').length, 0);
  });

  await withHarness('interrupt-ack', async (harness) => {
    const sessionId = start(harness);
    await waitForObservation(harness, (item) => item.type === 'turn-started');
    assert.equal(harness.client.stop(sessionId), true);
    await waitForObservation(harness, (item) => item.type === 'stop-unconfirmed', 7000);
    assert.equal(observations(harness, 'turn-completed').length, 0, 'interrupt RPC acknowledgement alone does not prove turn interruption');
    await waitForObservation(harness, (item) => item.type === 'child-status' && item.status === 'closed', 7000);
  });

  await withHarness('slow-turn-start', async (harness) => {
    const sessionId = start(harness);
    await waitForObservation(harness, (item) => item.type === 'turn-started');
    assert.equal(harness.client.stop(sessionId), true);
    const completion = await waitForObservation(harness, (item) => item.type === 'turn-completed');
    assert.equal(completion.type, 'turn-completed');
    assert.equal(completion.status, 'interrupted');
    await waitForObservation(harness, (item) => item.type === 'child-status' && item.status === 'closed');
    assert.equal(observations(harness, 'turn-started').length, 1, 'late turn/start response cannot restart or duplicate an interrupted turn');
  });
});

test('unsafe effective config, malformed JSONL, timeout, and discovery exit all fail closed and clean up owned children', async () => {
  for (const mode of ['unsafe-mcp-key', 'extra-enabled-mcp', 'malformed-json', 'discovery-init-exit']) {
    await withHarness(mode, async (harness) => {
      start(harness);
      await waitForObservation(harness, (item) => item.type === 'protocol-failure');
      await waitForObservation(harness, (item) => item.type === 'child-status' && (item.status === 'closed' || item.status === 'unknown'));
      const trace = await harness.readTrace();
      assert.equal(trace.some((entry) => entry.method === 'thread/start'), false, `${mode} must not start a task thread`);
      if (mode === 'discovery-init-exit') {
        assert.ok(observations(harness, 'child-status').some((item) => item.type === 'child-status' && item.status === 'closed'),
          'an unexpected discovery child exit is an observed close, not a confirmed turn result');
      }
    });
  }

  await withHarness('rpc-timeout', async (harness) => {
    start(harness);
    await waitForObservation(harness, (item) => item.type === 'protocol-failure', 4000);
    await waitForObservation(harness, (item) => item.type === 'child-status' && item.status === 'closed', 4000);
    assert.equal((await harness.readTrace()).some((entry) => entry.method === 'thread/start'), false);
  }, { rpcTimeoutMs: 800, closeTimeoutMs: 1000 });
});
