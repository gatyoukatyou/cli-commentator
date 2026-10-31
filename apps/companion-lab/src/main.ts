import { CompanionLabService } from './core.js';
import { startHttpServer } from './http.js';

const lab = new CompanionLabService();
const http = await startHttpServer(lab);
console.error(`架空の作業体験デモを起動しました。ブラウザーで ${http.origin}/ を開いてください。`);
console.error('このプロセスはループバックだけで待ち受け、実際のCLI実行・変更・共有は行いません。終了は Ctrl+C です。');

let closing: Promise<void> | null = null;
const shutdown = (): Promise<void> => {
  if (!closing) {
    closing = http.close().then(() => undefined).catch((error: unknown) => {
      console.error('デモサーバーの終了中に問題が起きました。', error);
      process.exitCode = 1;
    });
  }
  return closing;
};

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
