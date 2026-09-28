import { createCompanionLabService } from './service.js';
import { startHttpServer, type HttpServerHandle } from './http.js';

const lab = createCompanionLabService();
let http: HttpServerHandle | null = null;
let startup: Promise<HttpServerHandle> | null = null;
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
        await http?.close();
      } catch (error) {
        console.error('画面サーバーの終了中に問題が起きました。', error);
        process.exitCode = 1;
      }
      try {
        await lab.close?.();
      } catch (error) {
        console.error('接続サービスの終了中に問題が起きました。', error);
        process.exitCode = 1;
      }
    })();
  }
  return closing;
};

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

startup = startHttpServer(lab);
try {
  http = await startup;
} catch (error) {
  await lab.close?.().catch((closeError: unknown) => console.error('接続サービスの終了中のエラー:', closeError));
  throw error;
}

if (!shutdownRequested) {
  const snapshot = lab.snapshot();
  if (snapshot.simulationOnly) {
    console.error(`架空の作業体験デモを起動しました。ブラウザーで ${http.origin}/ を開いてください。`);
    console.error('このプロセスはループバックだけで待ち受け、実際のCLI実行・ファイル変更・共有は行いません。終了は Ctrl+C です。');
  } else {
    console.error(`Codexとの実接続画面を起動しました。ブラウザーで ${http.origin}/ を開いてください。`);
    console.error('練習用ファイルを読み、Codexの既存の認証・利用枠を使います（ChatGPTログインの場合はサブスク枠）。終了は Ctrl+C です。');
  }
} else {
  await shutdown();
}
