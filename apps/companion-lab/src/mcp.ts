import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { CompanionLabServiceLike } from './service.js';

function mcpResult(simulationOnly: boolean, result: unknown) {
  const payload = { simulationOnly, result };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function createCompanionLabMcpServer(lab: CompanionLabServiceLike): McpServer {
  const simulationOnly = lab.snapshot().simulationOnly;
  const outputSchema = z.object({
    simulationOnly: z.literal(simulationOnly),
    result: z.unknown(),
  });
  const server = new McpServer(
    { name: 'cli-commentator-companion-lab', version: '0.1.0' },
    {
      instructions: simulationOnly
        ? 'これは架空の作業を使う体験デモです。結果はすべてシミュレーションのみで、実際のCLI実行・ファイル変更・共有はありません。人の承認はデモUIだけで受け付けます。'
        : 'これはCodexとの実接続です。練習用の固定sample.txtを読み、Codexの通常の作業進行を表示します。Codexの既存の認証・利用枠を使います（ChatGPTログインの場合はサブスク枠）。自由な依頼・作業場所は指定できません。人の承認は画面で受け付けます。',
    },
  );

  if (simulationOnly) {
    server.registerTool(
      'start_demo',
      {
        title: '架空のデモを開始',
        description: '架空の作業体験を開始します。get_demo_stateで取得したgenerationを渡してください。終了後は新しいsessionとして再開できます。シミュレーションのみです。',
        inputSchema: z.object({ expectedGeneration: z.number().int().nonnegative() }).strict(),
        outputSchema,
      },
      async ({ expectedGeneration }) => mcpResult(true, await lab.start(expectedGeneration)),
    );

    server.registerTool(
      'advance_demo',
      {
        title: '架空のデモを一段進める',
        description: '期待するgenerationを指定して架空の作業を一段だけ進めます。承認待ちは通過できません。generation不一致の再送は拒否します。シミュレーションのみです。',
        inputSchema: z.object({ expectedGeneration: z.number().int().nonnegative() }).strict(),
        outputSchema,
      },
      async ({ expectedGeneration }) => mcpResult(true, await lab.advance(expectedGeneration)),
    );

    server.registerTool(
      'get_demo_state',
      {
        title: '架空のデモ状態を取得',
        description: '現在地・変更・人の判断待ち・根拠イベントを返します。これはシミュレーションのみです。',
        inputSchema: z.object({}).strict(),
        outputSchema,
      },
      async () => mcpResult(true, lab.snapshot()),
    );

    server.registerTool(
      'explain_demo',
      {
        title: '架空のデモを説明',
        description: '現在の段階を、共有している根拠イベントから短く説明します。detail=trueで詳しい説明を返します。シミュレーションのみです。',
        inputSchema: z.object({ detail: z.boolean().optional() }).strict(),
        outputSchema,
      },
      async ({ detail }) => mcpResult(true, await lab.explain(detail === true)),
    );

    server.registerTool(
      'summarize_demo',
      {
        title: '架空のデモを要約',
        description: '現在地、通過した場面、変更、必要な判断を要約します。これはシミュレーションのみです。',
        inputSchema: z.object({}).strict(),
        outputSchema,
      },
      async () => mcpResult(true, await lab.summarize()),
    );

    server.registerTool(
      'stop_demo',
      {
        title: '架空のデモを停止',
        description: '体験デモを終了します。実作業や外部の停止操作はありません。シミュレーションのみです。',
        inputSchema: z.object({}).strict(),
        outputSchema,
      },
      async () => mcpResult(true, await lab.stop()),
    );
    return server;
  }

  server.registerTool(
    'start_codex_companion_lab',
    {
      title: 'Codexとの実接続を開始',
      description: '練習用の固定sample.txtを読み取るCodex接続を開始します。通常のCodex作業進行を画面で確認できます。Codexの既存の認証・利用枠を使います（ChatGPTログインの場合はサブスク枠）。自由な依頼・作業場所は指定できません。',
      inputSchema: z.object({ expectedGeneration: z.number().int().nonnegative() }).strict(),
      outputSchema,
    },
    async ({ expectedGeneration }) => mcpResult(false, await lab.start(expectedGeneration)),
  );

  server.registerTool(
    'get_codex_companion_lab_state',
    {
      title: 'Codex接続の状態を取得',
      description: '現在地、根拠、Codexのturn状態と子プロセス状態、最終報告を返します。実作業の成否を独立に検証するものではありません。',
      inputSchema: z.object({}).strict(),
      outputSchema,
    },
    async () => mcpResult(false, lab.snapshot()),
  );

  server.registerTool(
    'explain_codex_companion_lab',
    {
      title: 'Codex接続の状態を説明',
      description: '現在のCodex接続状況を根拠とともに説明します。detail=trueで詳しい説明を返します。',
      inputSchema: z.object({ detail: z.boolean().optional() }).strict(),
      outputSchema,
    },
    async ({ detail }) => mcpResult(false, await lab.explain(detail === true)),
  );

  server.registerTool(
    'summarize_codex_companion_lab',
    {
      title: 'Codex接続を要約',
      description: 'Codex接続の現在地、経過、判断待ちを要約します。',
      inputSchema: z.object({}).strict(),
      outputSchema,
    },
    async () => mcpResult(false, await lab.summarize()),
  );

  server.registerTool(
    'stop_codex_companion_lab',
    {
      title: 'Codex接続を停止',
      description: 'Codexへの停止要求を行い、その確認状況を返します。停止要求後も子プロセスの終了確認には時間がかかることがあります。',
      inputSchema: z.object({}).strict(),
      outputSchema,
    },
    async () => mcpResult(false, await lab.stop()),
  );

  return server;
}
