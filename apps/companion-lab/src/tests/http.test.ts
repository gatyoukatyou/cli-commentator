import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { CompanionLabService } from '../core.js';
import { startHttpServer } from '../http.js';

test('HTTP validates local origin, CSRF, size, schemas, and UI-shaped requests', async (context) => {
  const lab = new CompanionLabService();
  const server = await startHttpServer(lab, { port: 0 });
  context.after(async () => server.close());

  const page = await fetch(`${server.origin}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(page.headers.get('access-control-allow-origin'), null);
  assert.match(await page.text(), /これは架空の作業を使う体験デモです/);

  const csrfResponse = await fetch(`${server.origin}/api/csrf`);
  assert.equal(csrfResponse.status, 200);
  const csrf = await csrfResponse.json() as { simulationOnly: boolean; csrfToken: string };
  assert.equal(csrf.simulationOnly, true);
  const cookie = csrfResponse.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie);

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${server.origin}${path}`, {
    method: 'POST',
    headers: {
      origin: server.origin,
      'sec-fetch-site': 'same-origin',
      cookie,
      'x-csrf-token': csrf.csrfToken,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const crossOrigin = await post('/api/start', { expectedGeneration: 0 }, { origin: 'https://example.com', 'sec-fetch-site': 'cross-site' });
  assert.equal(crossOrigin.status, 403);
  const noCsrf = await post('/api/start', { expectedGeneration: 0 }, { 'x-csrf-token': 'missing' });
  assert.equal(noCsrf.status, 403);
  const invalidHost = await new Promise<number>((resolveStatus, reject) => {
    const request = httpRequest(`${server.origin}/api/state`, { headers: { host: 'example.com' } }, (response) => {
      response.resume();
      response.once('end', () => resolveStatus(response.statusCode ?? 0));
    });
    request.once('error', reject);
    request.end();
  });
  assert.equal(invalidHost, 403);

  const invalidStart = await post('/api/start', { expectedGeneration: '0' });
  assert.equal(invalidStart.status, 400);
  const oversized = await post('/api/start', { expectedGeneration: 0, extra: 'x'.repeat(5000) });
  assert.equal(oversized.status, 400);
  const selfDeclaredRole = await post('/api/start', { expectedGeneration: 0, role: 'human' });
  assert.equal(selfDeclaredRole.status, 400);

  const startedResponse = await post('/api/start', { expectedGeneration: 0 });
  assert.equal(startedResponse.status, 200);
  const started = await startedResponse.json() as { accepted: boolean; snapshot: { generation: number; phase: string; sessionId: string } };
  assert.equal(started.accepted, true);
  assert.equal(started.snapshot.phase, 'investigation');
  const replayedStart = await post('/api/start', { expectedGeneration: 0 });
  assert.equal(replayedStart.status, 409);

  const badAdvance = await post('/api/advance', { expectedGeneration: started.snapshot.generation, role: 'human' });
  assert.equal(badAdvance.status, 400);
  const firstAdvance = await post('/api/advance', { expectedGeneration: started.snapshot.generation });
  assert.equal(firstAdvance.status, 200);
  const advanced = await firstAdvance.json() as { snapshot: { generation: number; phase: string } };
  assert.equal(advanced.snapshot.phase, 'change');
  const duplicateAdvance = await post('/api/advance', { expectedGeneration: started.snapshot.generation });
  assert.equal(duplicateAdvance.status, 409);
  const duplicateResult = await duplicateAdvance.json() as { code: string; snapshot: { phase: string } };
  assert.equal(duplicateResult.code, 'stale_generation');
  assert.equal(duplicateResult.snapshot.phase, 'change');

  let current = advanced.snapshot;
  for (let step = 0; step < 4; step += 1) {
    const response = await post('/api/advance', { expectedGeneration: current.generation });
    assert.equal(response.status, 200);
    const result = await response.json() as { snapshot: typeof current };
    current = result.snapshot;
  }
  assert.equal(current.phase, 'approval');
  const blocked = await post('/api/advance', { expectedGeneration: current.generation });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json() as { code: string }).code, 'approval_required');

  const held = await post('/api/hold', {});
  assert.equal(held.status, 200);
  const holdState = await held.json() as { snapshot: { status: string; generation: number } };
  assert.equal(holdState.snapshot.status, 'awaiting-human');
  assert.equal(holdState.snapshot.generation, current.generation);

  const beforeDecision = await (await fetch(`${server.origin}/api/state`)).json() as { approval: { approvalId: string; expectedGeneration: number }; sessionId: string };
  const malformedDecision = await post('/api/decision', {
    sessionId: beforeDecision.sessionId,
    approvalId: beforeDecision.approval.approvalId,
    expectedGeneration: beforeDecision.approval.expectedGeneration,
    decision: 'approve',
    role: 'human',
  });
  assert.equal(malformedDecision.status, 400);
  const staleDecision = await post('/api/decision', {
    sessionId: beforeDecision.sessionId,
    approvalId: beforeDecision.approval.approvalId,
    expectedGeneration: beforeDecision.approval.expectedGeneration - 1,
    decision: 'reject',
  });
  assert.equal(staleDecision.status, 409);

  const decision = await post('/api/decision', {
    sessionId: beforeDecision.sessionId,
    approvalId: beforeDecision.approval.approvalId,
    expectedGeneration: beforeDecision.approval.expectedGeneration,
    decision: 'reject',
  });
  assert.equal(decision.status, 200);
  const finished = await decision.json() as { snapshot: { status: string; phaseLabel: string; generation: number } };
  assert.equal(finished.snapshot.status, 'finished');
  assert.equal(finished.snapshot.phaseLabel, 'デモ終了');
  const duplicateDecision = await post('/api/decision', {
    sessionId: beforeDecision.sessionId,
    approvalId: beforeDecision.approval.approvalId,
    expectedGeneration: beforeDecision.approval.expectedGeneration,
    decision: 'reject',
  });
  assert.equal(duplicateDecision.status, 409);

  const stoppedAfterRestart = await post('/api/start', { expectedGeneration: finished.snapshot.generation });
  assert.equal(stoppedAfterRestart.status, 200);
  const restart = await stoppedAfterRestart.json() as { snapshot: { generation: number; sessionId: string } };
  assert.notEqual(restart.snapshot.sessionId, beforeDecision.sessionId);
  const oldReply = await post('/api/decision', {
    sessionId: beforeDecision.sessionId,
    approvalId: beforeDecision.approval.approvalId,
    expectedGeneration: beforeDecision.approval.expectedGeneration,
    decision: 'approve',
  });
  assert.equal(oldReply.status, 409);

  const stopped = await post('/api/stop', {});
  assert.equal(stopped.status, 200);
  const stoppedState = await stopped.json() as { snapshot: { status: string; generation: number } };
  assert.equal(stoppedState.snapshot.status, 'stopped');
  const advanceAfterStop = await post('/api/advance', { expectedGeneration: stoppedState.snapshot.generation });
  assert.equal(advanceAfterStop.status, 409);
  assert.equal((await advanceAfterStop.json() as { code: string }).code, 'terminal');
});
