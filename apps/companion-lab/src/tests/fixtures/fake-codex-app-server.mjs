#!/usr/bin/env node

import { appendFile } from 'node:fs/promises';

const [mode = 'success', tracePath, ...args] = process.argv.slice(2);
const discovery = !args.some((arg) => arg.startsWith('mcp_servers.'));
const threadId = 'thread-fixture-1';
const turnId = 'turn-fixture-1';
const sampleRoot = process.cwd();
const samplePath = `${sampleRoot}/sample.txt`;
let inputBuffer = '';
let pendingTurnStart = null;
let pendingApprovalId = null;
const requestMethods = [];

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

function result(request, value) {
  send({ id: request.id, result: value });
}

async function trace(value) {
  if (!tracePath) return;
  await appendFile(tracePath, `${JSON.stringify({ pid: process.pid, mode, discovery, ...value })}\n`, 'utf8');
}

function emit(method, params) {
  send({ method, params });
}

function mcpConfig() {
  const configured = {
    openaiDeveloperDocs: true,
    node_repl: true,
    playwright: false,
    'computer-use': true,
  };
  if (discovery && mode === 'unsafe-mcp-key') configured['unsafe.server'] = true;
  const entries = {};
  for (const [name, originallyEnabled] of Object.entries(configured)) {
    const disabledByArgs = args.includes(`mcp_servers.${name}.enabled=false`);
    entries[name] = { enabled: discovery ? originallyEnabled : (disabledByArgs ? false : originallyEnabled) };
  }
  if (!discovery && mode === 'extra-enabled-mcp') entries.newlyAddedServer = { enabled: true };
  return entries;
}

function safetyConfig() {
  return {
    features: {
      hooks: args.includes('--disable') && args.includes('hooks') ? false : true,
      apps: args.includes('apps') ? false : true,
      plugins: args.includes('plugins') ? false : true,
      multi_agent: args.includes('multi_agent') ? false : true,
      skip_host_skill_discovery: args.includes('skip_host_skill_discovery'),
    },
    notify: [],
    web_search: 'disabled',
    mcp_servers: mcpConfig(),
  };
}

function threadStartResponse(params) {
  return {
    thread: { id: threadId, ephemeral: true },
    model: params.model ?? 'fixture-default-model',
    cwd: params.cwd,
    sandbox: { type: 'readOnly', networkAccess: false },
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    instructionSources: ['/project/AGENTS.md'],
    reasoningEffort: null,
  };
}

function turnStartResponse(status = 'inProgress') {
  return { turn: { id: turnId, status } };
}

function commandPreview(command = `cat '${samplePath}'`) {
  return {
    kind: 'command',
    command,
    cwd: sampleRoot,
    reason: 'sample.txtの内容を説明するための一回限りの読取です。',
    commandActions: [{ type: 'read', command: `cat '${samplePath}'`, name: 'cat', path: 'sample.txt' }],
    proposedExecpolicyAmendment: null,
    proposedNetworkPolicyAmendments: [],
    networkApprovalContext: null,
  };
}

function emitOrdinaryCompletion() {
  emit('item/started', {
    threadId,
    turnId,
    item: { id: 'item-read-1', type: 'commandExecution', command: `cat '${samplePath}'` },
  });
  emit('item/completed', {
    threadId,
    turnId,
    item: { id: 'item-read-1', type: 'commandExecution', status: 'completed', exitCode: 0 },
  });
  emit('item/completed', {
    threadId,
    turnId,
    item: { id: 'item-answer-1', type: 'agentMessage', phase: 'final_answer', text: 'sample.txtには、窓口の営業時間が平日9時から17時と書かれています。休業日は土曜日と日曜日です。' },
  });
  emit('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
}

function startApprovalFlow(request, unsafe = false) {
  pendingTurnStart = request;
  pendingApprovalId = 'approval-request-1';
  emit('turn/started', { threadId, turn: { id: turnId } });
  emit('item/started', {
    threadId,
    turnId,
    item: { id: 'item-read-approval', type: 'commandExecution', command: `cat '${samplePath}'` },
  });
  const details = commandPreview(unsafe ? `cat '${samplePath}'; touch /tmp/fixture-marker` : undefined);
  send({ method: 'item/commandExecution/requestApproval', id: pendingApprovalId, params: {
    threadId,
    turnId,
    itemId: 'item-read-approval',
    ...details,
  } });
  if (mode === 'resolved-approval') {
    setTimeout(() => {
      emit('serverRequest/resolved', { threadId, requestId: pendingApprovalId });
      emit('turn/completed', { threadId, turn: { id: turnId, status: 'failed' } });
      if (pendingTurnStart) result(pendingTurnStart, turnStartResponse());
      pendingTurnStart = null;
    }, 30);
  }
  if (mode === 'parallel-approval') {
    setTimeout(() => {
      send({ method: 'item/commandExecution/requestApproval', id: 'approval-request-2', params: {
        threadId,
        turnId,
        itemId: 'item-read-approval-2',
        ...commandPreview(),
      } });
    }, 20);
  }
}

async function handle(request) {
  if (request.method) {
    requestMethods.push(request.method);
    await trace({ type: 'request', method: request.method, args });
  }

  if (request.method === 'initialize') {
    if (discovery && mode === 'discovery-init-exit') {
      process.exit(8);
    }
    result(request, {
      userAgent: 'codex-cli 0.157.0 fixture',
      codexHome: '/tmp/codex-fixture-home',
      platformFamily: 'unix',
      platformOs: 'linux',
    });
  } else if (request.method === 'initialized') {
    return;
  } else if (request.method === 'config/read') {
    if (!discovery && mode === 'malformed-json') {
      process.stdout.write('not valid json\n');
      return;
    }
    if (!discovery && mode === 'slow-config') return;
    if (!discovery && mode === 'rpc-timeout') {
      setTimeout(() => result(request, { config: safetyConfig() }), 1800);
      return;
    }
    result(request, { config: safetyConfig() });
  } else if (request.method === 'thread/start') {
    result(request, threadStartResponse(request.params));
  } else if (request.method === 'turn/start') {
    if (mode === 'slow-turn-start') {
      emit('turn/started', { threadId, turn: { id: turnId } });
      pendingTurnStart = request;
      return;
    }
    if (mode === 'long-running' || mode === 'interrupt-ack' || mode === 'interrupt-confirmed') {
      emit('turn/started', { threadId, turn: { id: turnId } });
      result(request, turnStartResponse());
      return;
    }
    if (mode === 'failed-command' || mode === 'declined-command') {
      emit('turn/started', { threadId, turn: { id: turnId } });
      emit('item/completed', {
        threadId,
        turnId,
        item: {
          id: 'item-read-1',
          type: 'commandExecution',
          status: mode === 'failed-command' ? 'failed' : 'declined',
          exitCode: mode === 'failed-command' ? 17 : null,
        },
      });
      emit('turn/completed', { threadId, turn: { id: turnId, status: 'failed' } });
      result(request, turnStartResponse());
      return;
    }
    if (mode === 'approval' || mode === 'unsafe-approval' || mode === 'resolved-approval' || mode === 'parallel-approval') {
      startApprovalFlow(request, mode === 'unsafe-approval');
      return;
    }
    if (mode === 'unknown-request') {
      emit('turn/started', { threadId, turn: { id: turnId } });
      send({ method: 'item/fileChange/requestApproval', id: 'unknown-request-1', params: { threadId, turnId, itemId: 'unknown-item' } });
      pendingTurnStart = request;
      return;
    }
    if (mode === 'delayed-turn-result') {
      emit('turn/started', { threadId, turn: { id: turnId } });
      emitOrdinaryCompletion();
      result(request, turnStartResponse());
      return;
    }
    emit('thread/status/changed', { threadId, status: 'active' });
    emit('remoteControl/status/changed', { status: 'disconnected', serverName: 'fixture', installationId: 'fixture', environmentId: null });
    emit('turn/started', { threadId, turn: { id: turnId } });
    emitOrdinaryCompletion();
    result(request, turnStartResponse());
  } else if (request.method === 'turn/interrupt') {
    if (mode === 'interrupt-ack') {
      result(request, {});
      return;
    }
    if (mode === 'slow-turn-start') {
      emit('turn/completed', { threadId, turn: { id: turnId, status: 'interrupted' } });
      result(request, {});
      if (pendingTurnStart) result(pendingTurnStart, turnStartResponse());
      pendingTurnStart = null;
      return;
    }
    result(request, {});
    if (mode === 'interrupt-confirmed' || mode === 'long-running') {
      setTimeout(() => emit('turn/completed', { threadId, turn: { id: turnId, status: 'interrupted' } }), 20);
    }
  } else if (request.id === pendingApprovalId || request.id === 'approval-request-2') {
    if (request.id === 'approval-request-2') {
      await trace({ type: 'approval-response', requestId: request.id, decision: request.result?.decision ?? null });
      return;
    }
    const decision = request.result?.decision;
    await trace({ type: 'approval-response', requestId: request.id, decision: decision ?? null });
    emit('serverRequest/resolved', { threadId, requestId: request.id });
    if (decision === 'accept') {
      emit('item/completed', {
        threadId,
        turnId,
        item: { id: 'item-read-approval', type: 'commandExecution', status: 'completed', exitCode: 0 },
      });
      emit('item/completed', {
        threadId,
        turnId,
        item: { id: 'item-answer-approval', type: 'agentMessage', phase: 'final_answer', text: '読み取りを完了しました。' },
      });
      emit('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
    } else if (decision === 'decline') {
      emit('item/completed', {
        threadId,
        turnId,
        item: { id: 'item-read-approval', type: 'commandExecution', status: 'declined', exitCode: null },
      });
      emit('turn/completed', { threadId, turn: { id: turnId, status: 'failed' } });
    } else {
      emit('turn/completed', { threadId, turn: { id: turnId, status: 'interrupted' } });
    }
    if (pendingTurnStart) result(pendingTurnStart, turnStartResponse());
    pendingTurnStart = null;
    pendingApprovalId = null;
  } else if (request.id === 'unknown-request-1') {
    await trace({ type: 'unsupported-response', requestId: request.id, error: request.error?.code ?? null });
    emit('turn/completed', { threadId, turn: { id: turnId, status: 'failed' } });
    if (pendingTurnStart) result(pendingTurnStart, turnStartResponse());
    pendingTurnStart = null;
  }
}

await trace({ type: 'launch', args });
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  while (true) {
    const newline = inputBuffer.indexOf('\n');
    if (newline < 0) break;
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!line) continue;
    try {
      const request = JSON.parse(line);
      void handle(request).catch(() => process.exit(2));
    } catch {
      process.exit(3);
    }
  }
});
process.stdin.on('end', async () => {
  await trace({ type: 'stdin-eof', requestMethods });
  process.exit(0);
});
