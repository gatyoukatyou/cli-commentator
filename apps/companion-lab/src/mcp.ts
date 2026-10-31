import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { CompanionLabService } from './core.js';

const outputSchema = z.object({
  simulationOnly: z.literal(true),
  result: z.unknown(),
});

function mcpResult(result: unknown) {
  const payload = { simulationOnly: true as const, result };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function createCompanionLabMcpServer(lab: CompanionLabService): McpServer {
  const server = new McpServer(
    { name: 'cli-commentator-companion-lab', version: '0.1.0' },
    {
      instructions: 'これは架空の作業を使う体験デモです。結果はすべてシミュレーションのみで、実際のCLI実行・ファイル変更・共有はありません。人の承認はデモUIだけで受け付けます。',
    },
  );

  server.registerTool(
    'start_demo',
    {
      title: '架空のデモを開始',
      description: '架空の作業体験を開始します。get_demo_stateで取得したgenerationを渡してください。終了後は新しいsessionとして再開できます。シミュレーションのみです。',
      inputSchema: z.object({ expectedGeneration: z.number().int().nonnegative() }).strict(),
      outputSchema,
    },
    async ({ expectedGeneration }) => mcpResult(lab.start(expectedGeneration)),
  );

  server.registerTool(
    'advance_demo',
    {
      title: '架空のデモを一段進める',
      description: '期待するgenerationを指定して架空の作業を一段だけ進めます。承認待ちは通過できません。generation不一致の再送は拒否します。シミュレーションのみです。',
      inputSchema: z.object({ expectedGeneration: z.number().int().nonnegative() }).strict(),
      outputSchema,
    },
    async ({ expectedGeneration }) => mcpResult(lab.advance(expectedGeneration)),
  );

  server.registerTool(
    'get_demo_state',
    {
      title: '架空のデモ状態を取得',
      description: '現在地・変更・人の判断待ち・根拠イベントを返します。これはシミュレーションのみです。',
      inputSchema: z.object({}).strict(),
      outputSchema,
    },
    async () => mcpResult(lab.snapshot()),
  );

  server.registerTool(
    'explain_demo',
    {
      title: '架空のデモを説明',
      description: '現在の段階を、共有している根拠イベントから短く説明します。detail=trueで詳しい説明を返します。シミュレーションのみです。',
      inputSchema: z.object({ detail: z.boolean().optional() }).strict(),
      outputSchema,
    },
    async ({ detail }) => mcpResult(lab.explain(detail === true)),
  );

  server.registerTool(
    'summarize_demo',
    {
      title: '架空のデモを要約',
      description: '現在地、通過した場面、変更、必要な判断を要約します。これはシミュレーションのみです。',
      inputSchema: z.object({}).strict(),
      outputSchema,
    },
    async () => mcpResult(lab.summarize()),
  );

  server.registerTool(
    'stop_demo',
    {
      title: '架空のデモを停止',
      description: '体験デモを終了します。実作業や外部の停止操作はありません。シミュレーションのみです。',
      inputSchema: z.object({}).strict(),
      outputSchema,
    },
    async () => mcpResult(lab.stop()),
  );

  return server;
}
