import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import type { HumanDecision, OperationResult } from './core.js';
import type { Awaitable, CompanionLabServiceLike } from './service.js';

const MAX_BODY_BYTES = 4096;
const CSRF_COOKIE = 'companion_lab_csrf';
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

export interface HttpServerHandle {
  origin: string;
  port: number;
  close(): Promise<void>;
}

interface StartOptions {
  port?: number;
  host?: string;
}

export async function startHttpServer(
  lab: CompanionLabServiceLike,
  { port = Number(process.env.COMPANION_LAB_PORT ?? 43210), host = '127.0.0.1' }: StartOptions = {},
): Promise<HttpServerHandle> {
  if (host !== '127.0.0.1') throw new Error('The demo server can only bind to 127.0.0.1.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local demo port.');

  const csrfToken = randomBytes(32).toString('hex');
  let origin = '';
  let boundPort = port;
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      sendJson(response, 500, { simulationOnly: simulationOnly(), error: 'internal_error' });
    });
  });
  server.maxHeadersCount = 32;
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;

  server.listen(port, host);
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine the local demo port.');
  boundPort = address.port;
  origin = `http://127.0.0.1:${boundPort}`;

  return {
    origin,
    port: boundPort,
    close: () => closeServer(server),
  };

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    applySecurityHeaders(response);
    if (request.headers.host !== `127.0.0.1:${boundPort}`) {
      sendJson(response, 403, { simulationOnly: simulationOnly(), error: 'invalid_host' });
      return;
    }

    const url = new URL(request.url ?? '/', origin);
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await readFile(`${publicDir}index.html`));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await readFile(`${publicDir}app.js`));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/styles.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await readFile(`${publicDir}styles.css`));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, lab.snapshot());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/csrf') {
      response.setHeader('set-cookie', `${CSRF_COOKIE}=${csrfToken}; SameSite=Strict; HttpOnly; Path=/`);
      sendJson(response, 200, { simulationOnly: simulationOnly(), csrfToken });
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 404, { simulationOnly: simulationOnly(), error: 'not_found' });
      return;
    }
    if (!hasSameOrigin(request, origin)) {
      sendJson(response, 403, { simulationOnly: simulationOnly(), error: 'origin_rejected' });
      return;
    }
    if (!hasCsrf(request, csrfToken)) {
      sendJson(response, 403, { simulationOnly: simulationOnly(), error: 'csrf_rejected' });
      return;
    }

    if (url.pathname === '/api/start') {
      const body = await readJsonObject(request);
      if (body === null || Object.keys(body).some((key) => key !== 'expectedGeneration') || !isGeneration(body.expectedGeneration)) {
        sendJson(response, 400, { simulationOnly: simulationOnly(), error: 'invalid_input' });
        return;
      }
      await sendOperation(response, lab.start(body.expectedGeneration));
      return;
    }
    if (url.pathname === '/api/advance') {
      const body = await readJsonObject(request);
      if (body === null || Object.keys(body).some((key) => key !== 'expectedGeneration') || !isGeneration(body.expectedGeneration)) {
        sendJson(response, 400, { simulationOnly: simulationOnly(), error: 'invalid_input' });
        return;
      }
      if (!lab.snapshot().capabilities.advance) {
        await sendOperation(response, unsupportedOperation('advance'));
        return;
      }
      await sendOperation(response, lab.advance(body.expectedGeneration));
      return;
    }
    if (url.pathname === '/api/hold') {
      const body = await readJsonObject(request);
      if (body === null || Object.keys(body).length > 0) {
        sendJson(response, 400, { simulationOnly: simulationOnly(), error: 'invalid_input' });
        return;
      }
      if (!lab.snapshot().capabilities.hold) {
        await sendOperation(response, unsupportedOperation('hold'));
        return;
      }
      await sendOperation(response, lab.hold());
      return;
    }
    if (url.pathname === '/api/stop') {
      const body = await readJsonObject(request);
      if (body === null || Object.keys(body).length > 0) {
        sendJson(response, 400, { simulationOnly: simulationOnly(), error: 'invalid_input' });
        return;
      }
      await sendOperation(response, lab.stop());
      return;
    }
    if (url.pathname === '/api/explain') {
      const body = await readJsonObject(request);
      if (body === null || Object.keys(body).some((key) => key !== 'detail') || (body.detail !== undefined && typeof body.detail !== 'boolean')) {
        sendJson(response, 400, { simulationOnly: simulationOnly(), error: 'invalid_input' });
        return;
      }
      sendJson(response, 200, await lab.explain(body.detail === true));
      return;
    }
    if (url.pathname === '/api/decision') {
      const body = await readJsonObject(request);
      if (
        body === null
        || Object.keys(body).some((key) => !['sessionId', 'approvalId', 'expectedGeneration', 'decision'].includes(key))
        || typeof body.sessionId !== 'string'
        || body.sessionId.length > 64
        || typeof body.approvalId !== 'string'
        || body.approvalId.length > 64
        || !isGeneration(body.expectedGeneration)
        || (body.decision !== 'approve' && body.decision !== 'reject')
      ) {
        sendJson(response, 400, { simulationOnly: simulationOnly(), error: 'invalid_input' });
        return;
      }
      await sendOperation(response, lab.decideFromHuman({
        sessionId: body.sessionId,
        approvalId: body.approvalId,
        expectedGeneration: body.expectedGeneration,
        decision: body.decision as HumanDecision,
      }));
      return;
    }
    sendJson(response, 404, { simulationOnly: simulationOnly(), error: 'not_found' });
  }

  function simulationOnly(): boolean {
    try {
      return lab.snapshot().simulationOnly;
    } catch {
      return false;
    }
  }

  function unsupportedOperation(operation: 'advance' | 'hold'): OperationResult {
    const current = lab.snapshot();
    return {
      simulationOnly: current.simulationOnly,
      accepted: false,
      code: 'unsupported_capability',
      message: operation === 'advance'
        ? '実接続モードでは「次へ進む」操作は使えません。Codexの進行状況は自動で更新されます。'
        : '実接続モードでは保留操作は使えません。判断が必要な場合は、表示された内容を確認してください。',
      operationId: `unsupported-${randomUUID()}`,
      snapshot: current,
    };
  }

  async function sendOperation(response: ServerResponse, operation: Awaitable<OperationResult>): Promise<void> {
    const result = await operation;
    sendJson(response, result.accepted ? 200 : 409, result);
  }
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'same-origin');
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader('cache-control', 'no-store');
}

function hasSameOrigin(request: IncomingMessage, origin: string): boolean {
  const fetchSite = request.headers['sec-fetch-site'];
  return request.headers.origin === origin && (fetchSite === undefined || fetchSite === 'same-origin');
}

function hasCsrf(request: IncomingMessage, expected: string): boolean {
  const header = request.headers['x-csrf-token'];
  const cookieHeader = request.headers.cookie;
  if (typeof header !== 'string' || typeof cookieHeader !== 'string') return false;
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${CSRF_COOKIE}=`))?.slice(CSRF_COOKIE.length + 1);
  if (!cookie || cookie.length !== expected.length || header.length !== expected.length) return false;
  const expectedBytes = Buffer.from(expected);
  return timingSafeEqual(Buffer.from(cookie), expectedBytes) && timingSafeEqual(Buffer.from(header), expectedBytes);
}

async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) return null;
  const length = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  if (response.headersSent) return;
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}
