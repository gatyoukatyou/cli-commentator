import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { CompanionLabService } from './core.js';
import { startHttpServer } from './http.js';
import { createCompanionLabMcpServer } from './mcp.js';

const lab = new CompanionLabService();
const http = await startHttpServer(lab);
console.error(`架空の作業体験デモをstdio MCPで起動しました。人の操作画面: ${http.origin}/`);
console.error('stdioはMCP通信用です。実際のCLI実行・変更・共有は行いません。');

const mcp = serveStdio(() => createCompanionLabMcpServer(lab), {
  onerror: (error) => console.error('MCP接続エラー:', error.message),
});

let closing: Promise<void> | null = null;
const shutdown = (): Promise<void> => {
  if (!closing) {
    closing = (async () => {
      await mcp.close().catch((error: unknown) => console.error('MCP終了中のエラー:', error));
      await http.close().catch((error: unknown) => console.error('HTTP終了中のエラー:', error));
    })();
  }
  return closing;
};

process.stdin.once('end', () => { void shutdown(); });
process.stdin.once('close', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
