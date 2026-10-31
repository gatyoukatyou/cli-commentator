import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createCompanionLabService } from './service.js';
import { startHttpServer, type HttpServerHandle } from './http.js';
import { createCompanionLabMcpServer } from './mcp.js';

const lab = createCompanionLabService();
let http: HttpServerHandle | null = null;
let startup: Promise<HttpServerHandle> | null = null;
let mcp: ReturnType<typeof serveStdio> | null = null;
let closing: Promise<void> | null = null;
let shutdownRequested = false;

const shutdown = (): Promise<void> => {
  shutdownRequested = true;
  if (!closing) {
    closing = (async () => {
      if (!http && startup) {
        try {
          http = await startup;
        } catch {
          // There is no listener to close when startup failed.
        }
      }
      try {
        await mcp?.close();
      } catch (error) {
        console.error('MCP終了中のエラー:', error);
      }
      try {
        await http?.close();
      } catch (error) {
        console.error('HTTP終了中のエラー:', error);
      }
      try {
        await lab.close?.();
      } catch (error) {
        console.error('接続サービスの終了中のエラー:', error);
      }
    })();
  }
  return closing;
};

process.stdin.once('end', () => { void shutdown(); });
process.stdin.once('close', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

startup = startHttpServer(lab);
try {
  http = await startup;
} catch (error) {
  try {
    await lab.close?.();
  } catch (closeError) {
    console.error('接続サービスの終了中のエラー:', closeError);
  }
  throw error;
}

if (shutdownRequested) {
  await shutdown();
} else {
  mcp = serveStdio(() => createCompanionLabMcpServer(lab), {
    onerror: (error) => console.error('MCP接続エラー:', error.message),
  });
  const snapshot = lab.snapshot();
  if (snapshot.simulationOnly) {
    console.error(`架空の作業体験デモをstdio MCPで起動しました。人の操作画面: ${http.origin}/`);
    console.error('stdioはMCP通信用です。実際のCLI実行・変更・共有は行いません。');
  } else {
    console.error(`Codexとの実接続をstdio MCPで起動しました。人の操作画面: ${http.origin}/`);
    console.error('練習用ファイルを読み、Codexの既存の認証・利用枠を使います（ChatGPTログインの場合はサブスク枠）。stdio stdoutはMCP通信用です。');
  }
}
