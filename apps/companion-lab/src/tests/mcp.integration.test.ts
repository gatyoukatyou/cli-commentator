import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');

async function unusedPort(): Promise<number> {
  const server = createNetServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  return address.port;
}

async function waitForExit(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`MCP launcher process ${pid} did not exit after its stdio client disconnected.`);
}

function unpack(result: unknown): Record<string, any> {
  const value = result as { structuredContent?: Record<string, any> };
  assert.ok(value.structuredContent, 'SDK client should receive MCP structuredContent');
  assert.equal(value.structuredContent.simulationOnly, true);
  return value.structuredContent;
}

test('official MCP stdio client and loopback UI share one process state', { timeout: 20000 }, async () => {
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const transport = new StdioClientTransport({
    command: 'pnpm',
    args: ['--silent', 'mcp:companion-lab'],
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...(process.env.COREPACK_HOME ? { COREPACK_HOME: process.env.COREPACK_HOME } : {}),
      COMPANION_LAB_PORT: String(port),
      CI: '1',
    },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
  const client = new Client({ name: 'companion-lab-integration-test', version: '0.1.0' });
  let pid: number | null = null;

  try {
    await client.connect(transport);
    pid = transport.pid;
    assert.ok(pid);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), [
      'advance_demo',
      'explain_demo',
      'get_demo_state',
      'start_demo',
      'stop_demo',
      'summarize_demo',
    ]);
    assert.equal(names.some((name) => /approve|decision/i.test(name)), false);

    const startResult = unpack(await client.callTool({ name: 'start_demo', arguments: { expectedGeneration: 0 } }));
    assert.equal(startResult.result.accepted, true);
    const startState = startResult.result.snapshot;
    const uiState = await (await fetch(`${origin}/api/state`)).json() as Record<string, any>;
    assert.equal(uiState.simulationOnly, true);
    assert.equal(uiState.sessionId, startState.sessionId);
    assert.equal(uiState.generation, startState.generation);
    assert.equal(uiState.phase, startState.phase);

    let state = uiState;
    for (let step = 0; step < 5; step += 1) {
      const result = unpack(await client.callTool({ name: 'advance_demo', arguments: { expectedGeneration: state.generation } }));
      assert.equal(result.result.accepted, true);
      state = await (await fetch(`${origin}/api/state`)).json() as Record<string, any>;
      assert.equal(state.generation, result.result.snapshot.generation);
    }
    assert.equal(state.status, 'awaiting-human');
    assert.equal(state.phase, 'approval');

    const blocked = unpack(await client.callTool({ name: 'advance_demo', arguments: { expectedGeneration: state.generation } }));
    assert.equal(blocked.result.accepted, false);
    assert.equal(blocked.result.code, 'approval_required');
    let selfClaimed: unknown;
    try {
      selfClaimed = await client.callTool({
        name: 'advance_demo',
        arguments: { expectedGeneration: state.generation, role: 'human', decision: 'approve' },
      });
    } catch {
      // Strict MCP input validation may reject this as a protocol error before a tool result exists.
    }
    assert.ok(!selfClaimed || (selfClaimed as { isError?: boolean }).isError === true);
    const afterClaim = await (await fetch(`${origin}/api/state`)).json() as Record<string, any>;
    assert.equal(afterClaim.status, 'awaiting-human');

    const csrfResponse = await fetch(`${origin}/api/csrf`);
    const csrf = await csrfResponse.json() as { csrfToken: string };
    const cookie = csrfResponse.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie);
    const humanResponse = await fetch(`${origin}/api/decision`, {
      method: 'POST',
      headers: {
        origin,
        cookie,
        'x-csrf-token': csrf.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: afterClaim.sessionId,
        approvalId: afterClaim.approval.approvalId,
        expectedGeneration: afterClaim.approval.expectedGeneration,
        decision: 'reject',
      }),
    });
    assert.equal(humanResponse.status, 200);
    const fromHttp = await humanResponse.json() as { snapshot: Record<string, any> };
    assert.equal(fromHttp.snapshot.status, 'finished');

    const fromMcp = unpack(await client.callTool({ name: 'get_demo_state', arguments: {} }));
    assert.equal(fromMcp.result.sessionId, fromHttp.snapshot.sessionId);
    assert.equal(fromMcp.result.generation, fromHttp.snapshot.generation);
    assert.equal(fromMcp.result.status, 'finished');
    assert.match(stderr, /stdio MCPで起動しました/);
  } finally {
    const childPid = pid ?? transport.pid;
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    if (childPid) await waitForExit(childPid);
  }

  await assert.rejects(fetch(`${origin}/api/state`), /fetch failed|ECONNREFUSED/);
});

test('stdio EOF closes the co-located HTTP listener without leaving the launcher running', { timeout: 12000 }, async () => {
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn('pnpm', ['--silent', 'mcp:companion-lab'], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...(process.env.COREPACK_HOME ? { COREPACK_HOME: process.env.COREPACK_HOME } : {}),
      COMPANION_LAB_PORT: String(port),
      CI: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  let didExit = false;
  child.once('exit', () => { didExit = true; });

  try {
    await new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error(`MCP HTTP startup timed out. stderr: ${stderr}`)), 5000);
      const onData = (chunk: string) => {
        if (stderr.includes('stdio MCPで起動しました')) {
          clearTimeout(timeout);
          resolveReady();
        }
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timeout);
        rejectReady(new Error(`MCP launcher exited before startup (code=${code}, signal=${signal}). stderr: ${stderr}`));
      };
      child.stderr.on('data', onData);
      child.once('exit', onExit);
    });

    assert.equal((await fetch(`${origin}/api/state`)).status, 200);
    child.stdin.end();
    const exit = await waitForChildExit(child, 5000);
    didExit = true;
    assert.equal(exit.code, 0, `launcher should exit cleanly after stdin EOF; stderr: ${stderr}`);
    assert.equal(stdout, '', 'the public MCP command must keep stdout reserved for protocol messages');
    await assert.rejects(fetch(`${origin}/api/state`), /fetch failed|ECONNREFUSED/);
  } finally {
    if (!didExit) {
      child.stdin.end();
      try {
        await waitForChildExit(child, 2000);
      } catch {
        child.kill('SIGTERM');
        await waitForChildExit(child, 2000).catch(() => undefined);
      }
    }
  }
});

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
