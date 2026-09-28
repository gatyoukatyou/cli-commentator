import { randomUUID } from 'node:crypto';

export type LabStatus =
  | 'not-started'
  | 'running'
  | 'awaiting-human'
  | 'finished'
  | 'stopped'
  | 'unknown';

export type LabPhase =
  | 'not-started'
  | 'investigation'
  | 'change'
  | 'test-failed'
  | 'correction'
  | 'test-passed'
  | 'approval'
  | 'finished'
  | 'stopped';

export type HumanDecision = 'approve' | 'reject';
export type ApprovalStatus = HumanDecision | 'pending' | 'cancelled';

export interface Evidence {
  id: string;
  source: 'fictional-scenario' | 'human-ui' | 'demo-control';
  statement: string;
}

export interface DialogueLine {
  role: '実況' | '解説';
  text: string;
  evidenceIds: string[];
}

export interface LabEvent {
  eventId: string;
  operationId: string;
  sequence: number;
  sessionId: string;
  phase: LabPhase;
  phaseLabel: string;
  createdAt: string;
  evidence: Evidence[];
  dialogue: [DialogueLine, DialogueLine];
}

export interface ApprovalRecord {
  approvalId: string;
  sessionId: string;
  expectedGeneration: number;
  status: ApprovalStatus;
  title: string;
  details: string;
}

export interface LabSnapshot {
  simulationOnly: true;
  sessionId: string | null;
  status: LabStatus;
  phase: LabPhase;
  phaseLabel: string;
  generation: number;
  currentOperationId: string | null;
  updatedAt: string | null;
  currentWork: string;
  changed: string;
  decision: string;
  approval: ApprovalRecord | null;
  events: LabEvent[];
}

export interface OperationResult {
  simulationOnly: true;
  accepted: boolean;
  code: string;
  message: string;
  operationId: string;
  snapshot: LabSnapshot;
}

interface StageDefinition {
  phase: LabPhase;
  currentWork: string;
  changed: string;
  decision: string;
  evidence: string;
  lines: [string, string];
}

const scenario: StageDefinition[] = [
  {
    phase: 'investigation',
    currentWork: '架空の入力処理を調べています。',
    changed: 'まだ変更していません。空の入力で表示が乱れる例を見つけました。',
    decision: '今は判断不要です。',
    evidence: '架空の調査記録: src/format.ts で空の入力を扱う条件を確認しました。',
    lines: [
      '入力が空のときに表示が乱れる例を見つけたよ。',
      '入力がない場合の扱いを決めておくと、利用者が迷わず次へ進めます。',
    ],
  },
  {
    phase: 'change',
    currentWork: '空の入力を扱う修正案を作っています。',
    changed: '架空の src/format.ts に条件を1か所追加しました。',
    decision: '今は判断不要です。',
    evidence: '架空の変更記録: src/format.ts の入力判定を調整しました。',
    lines: [
      '空の入力を扱う条件を1か所変えたよ。',
      'まずは入力がある場合の動きを保ったまま、空の場合だけ整えます。',
    ],
  },
  {
    phase: 'test-failed',
    currentWork: '最初の架空テスト結果を確認しています。',
    changed: '空白だけの入力で期待した結果にならず、最初の確認は失敗しました。',
    decision: '今は判断不要です。修正を続けます。',
    evidence: '架空のテスト記録: 空白だけの入力を扱う確認が失敗しました。',
    lines: [
      '最初の確認は失敗。空白だけの入力で期待と違う結果だったよ。',
      'ひとつの確認で問題が見つかった段階です。作業全体が失敗して終わったわけではありません。',
    ],
  },
  {
    phase: 'correction',
    currentWork: '空白だけの入力も扱えるよう、修正案を調整しています。',
    changed: '架空の src/format.ts に空白を判定する条件を加えました。',
    decision: '今は判断不要です。',
    evidence: '架空の変更記録: 空白だけの入力を判定する条件を加えました。',
    lines: [
      '空白だけの入力も扱えるように、修正案を調整したよ。',
      '見つかった例に合わせて条件を足しました。次は同じ確認をやり直します。',
    ],
  },
  {
    phase: 'test-passed',
    currentWork: '調整後の架空テスト結果を確認しました。',
    changed: '空の入力と空白だけの入力の確認が通りました。',
    decision: '次は修正案の共有について、あなたの判断が必要です。',
    evidence: '架空のテスト記録: 2つの入力例を扱う確認が成功しました。',
    lines: [
      '調整後の確認は成功。2つの入力例で期待どおりになったよ。',
      'テストの成功は、選んだ確認項目が通ったという意味です。共有の許可とは別です。',
    ],
  },
  {
    phase: 'approval',
    currentWork: '架空の修正案を共有する前に、あなたの返答を待っています。',
    changed: '変更案は架空の src/format.ts 1ファイルです。',
    decision: '「修正案の共有」を承認するか、拒否するか、保留できます。実際の共有は行いません。',
    evidence: '架空の提案: src/format.ts の修正案をチームへ共有する場面です。共有先への接続はありません。',
    lines: [
      '修正案を共有する前に、あなたの判断を待っているよ。',
      '確認に通ったことと、誰かへ共有してよいことは別の判断です。対象は1ファイルです。',
    ],
  },
];

const phaseLabels: Record<LabPhase, string> = {
  'not-started': '未開始',
  investigation: '調査中',
  change: '修正中',
  'test-failed': 'テスト失敗',
  correction: '修正を調整中',
  'test-passed': 'テスト成功',
  approval: 'あなたの判断待ち',
  finished: 'デモ終了',
  stopped: 'デモ停止',
};

const isTerminal = (status: LabStatus): status is 'finished' | 'stopped' =>
  status === 'finished' || status === 'stopped';

export class CompanionLabService {
  private status: LabStatus = 'not-started';
  private phase: LabPhase = 'not-started';
  private generation = 0;
  private operationSequence = 0;
  private sessionId: string | null = null;
  private updatedAt: string | null = null;
  private currentOperationId: string | null = null;
  private currentWork = '開始すると、架空の作業を順番に体験できます。';
  private changed = 'まだ何も変更していません。';
  private decision = '開始して、台本の調査から進めてください。';
  private approval: ApprovalRecord | null = null;
  private events: LabEvent[] = [];

  snapshot(): LabSnapshot {
    return structuredClone({
      simulationOnly: true as const,
      sessionId: this.sessionId,
      status: this.status,
      phase: this.phase,
      phaseLabel: phaseLabels[this.phase],
      generation: this.generation,
      currentOperationId: this.currentOperationId,
      updatedAt: this.updatedAt,
      currentWork: this.currentWork,
      changed: this.changed,
      decision: this.decision,
      approval: this.approval,
      events: this.events,
    });
  }

  start(expectedGeneration: number): OperationResult {
    const operationId = this.nextOperationId();
    if (expectedGeneration !== this.generation) {
      return this.result(false, 'stale_generation', '画面の状態が更新されています。最新の状態を確認してから開始してください。', operationId);
    }
    if (this.status === 'unknown') {
      return this.result(false, 'state_unknown', '状態を確認できないため、新しいデモを開始できません。', operationId);
    }
    if (this.status !== 'not-started' && !isTerminal(this.status)) {
      return this.result(false, 'already_started', 'このデモはすでに進行中です。', operationId);
    }

    this.sessionId = randomUUID();
    this.status = 'running';
    this.approval = null;
    this.events = [];
    this.recordStage(scenario[0], operationId);
    return this.result(true, expectedGeneration === 0 ? 'started' : 'restarted', '新しい架空のデモを開始しました。', operationId);
  }

  advance(expectedGeneration: number): OperationResult {
    const operationId = this.nextOperationId();
    if (expectedGeneration !== this.generation) {
      return this.result(false, 'stale_generation', '画面の状態が更新されています。最新の状態を確認してから進めてください。', operationId);
    }
    if (this.status === 'not-started') {
      return this.result(false, 'not_started', '先にデモを開始してください。', operationId);
    }
    if (this.status === 'awaiting-human') {
      return this.result(false, 'approval_required', '承認待ちです。進行操作では通過できません。人の返答を待っています。', operationId);
    }
    if (isTerminal(this.status)) {
      return this.result(false, 'terminal', '終了したデモは進行できません。', operationId);
    }

    const nextIndex = scenario.findIndex((stage) => stage.phase === this.phase) + 1;
    if (nextIndex < 0 || nextIndex >= scenario.length) {
      return this.result(false, 'no_next_step', '次の架空場面がありません。', operationId);
    }
    const stage = scenario[nextIndex];
    this.status = stage.phase === 'approval' ? 'awaiting-human' : 'running';
    this.recordStage(stage, operationId);
    if (stage.phase === 'approval') {
      this.approval = {
        approvalId: randomUUID(),
        sessionId: this.sessionId!,
        expectedGeneration: this.generation,
        status: 'pending',
        title: '修正案の共有',
        details: '架空の src/format.ts 1ファイルをチームへ共有する想定です。共有先には接続せず、承認しても実際の共有は行いません。',
      };
    }
    return this.result(true, stage.phase === 'approval' ? 'approval_waiting' : 'advanced', `${phaseLabels[stage.phase]}へ進みました。`, operationId);
  }

  hold(): OperationResult {
    const operationId = this.nextOperationId();
    if (this.status !== 'awaiting-human' || this.approval?.status !== 'pending') {
      return this.result(false, 'nothing_to_hold', '保留できる判断待ちはありません。', operationId);
    }
    return this.result(true, 'held', '判断を保留しました。デモは返答待ちのままです。', operationId);
  }

  decideFromHuman(input: {
    sessionId: string;
    approvalId: string;
    expectedGeneration: number;
    decision: HumanDecision;
  }): OperationResult {
    const operationId = this.nextOperationId();
    if (input.sessionId !== this.sessionId) {
      return this.result(false, 'session_mismatch', 'この返答は現在のデモに結びついていません。', operationId);
    }
    if (
      this.status !== 'awaiting-human'
      || this.approval?.status !== 'pending'
      || input.approvalId !== this.approval.approvalId
      || input.expectedGeneration !== this.approval.expectedGeneration
      || input.expectedGeneration !== this.generation
    ) {
      return this.result(false, 'stale_approval', 'この返答は古いか、すでに処理されています。現在の状態を確認してください。', operationId);
    }

    const accepted = input.decision === 'approve';
    const evidence: Evidence = {
      id: `human-${operationId}`,
      source: 'human-ui',
      statement: accepted
        ? '利用者がデモ画面で架空の共有案を承認しました。実際の共有は行っていません。'
        : '利用者がデモ画面で架空の共有案を拒否しました。実際の共有は行っていません。',
    };
    this.status = 'finished';
    this.phase = 'finished';
    this.generation += 1;
    this.updatedAt = new Date().toISOString();
    this.currentOperationId = operationId;
    this.currentWork = '架空の修正案についての返答を受け付け、デモを終了しました。';
    this.changed = accepted
      ? '承認を記録しました。実際の共有や外部操作は行っていません。'
      : '拒否を記録しました。実際の共有や外部操作は行っていません。';
    this.decision = accepted
      ? 'あなたは架空の共有案を承認しました。デモは終了です。'
      : 'あなたは架空の共有案を拒否しました。デモは終了です。';
    this.approval = { ...this.approval, status: input.decision };
    this.events.push({
      eventId: `event-${this.generation}`,
      operationId,
      sequence: this.generation,
      sessionId: this.sessionId,
      phase: 'finished',
      phaseLabel: phaseLabels.finished,
      createdAt: this.updatedAt,
      evidence: [evidence],
      dialogue: [
        {
          role: '実況',
          text: accepted ? '承認を受け付けて、デモを終えたよ。' : '拒否を受け付けて、デモを終えたよ。',
          evidenceIds: [evidence.id],
        },
        {
          role: '解説',
          text: 'これはデモ内の返答です。実際の共有やファイル操作は行っていません。',
          evidenceIds: [evidence.id],
        },
      ],
    });
    return this.result(true, accepted ? 'approved_in_demo' : 'rejected_in_demo', 'デモ内の返答を記録しました。実際の共有は行っていません。', operationId);
  }

  stop(): OperationResult {
    const operationId = this.nextOperationId();
    if (isTerminal(this.status)) {
      return this.result(false, 'terminal', 'デモはすでに終了しています。', operationId);
    }
    if (!this.sessionId) this.sessionId = randomUUID();
    const evidence: Evidence = {
      id: `control-${operationId}`,
      source: 'demo-control',
      statement: '利用者が架空の体験デモを停止しました。実際のCLIや共有先に対する操作はありません。',
    };
    this.status = 'stopped';
    this.phase = 'stopped';
    this.generation += 1;
    this.updatedAt = new Date().toISOString();
    this.currentOperationId = operationId;
    this.currentWork = '体験デモを停止しました。';
    this.changed = 'デモを止めました。実際の作業には触れていません。';
    this.decision = 'このデモは停止済みです。';
    if (this.approval?.status === 'pending') {
      this.approval = { ...this.approval, status: 'cancelled' };
    }
    this.events.push({
      eventId: `event-${this.generation}`,
      operationId,
      sequence: this.generation,
      sessionId: this.sessionId,
      phase: 'stopped',
      phaseLabel: phaseLabels.stopped,
      createdAt: this.updatedAt,
      evidence: [evidence],
      dialogue: [
        { role: '実況', text: '体験デモを止めたよ。', evidenceIds: [evidence.id] },
        { role: '解説', text: '実際のCLI操作や共有は行っていません。', evidenceIds: [evidence.id] },
      ],
    });
    return this.result(true, 'stopped', '体験デモを停止しました。', operationId);
  }

  explain(detail = false): { simulationOnly: true; summary: string; detail: string; evidence: Evidence[]; generation: number } {
    const latest = this.events.at(-1);
    return {
      simulationOnly: true,
      summary: `${this.phaseLabel}: ${this.currentWork} ${this.changed} ${this.decision}`,
      detail: detail
        ? latest
          ? `${latest.phaseLabel}。${this.currentWork} ${this.changed} ${this.decision}`
          : 'まだデモを開始していません。開始すると架空の台本が進みます。'
        : this.decision,
      evidence: latest ? structuredClone(latest.evidence) : [],
      generation: this.generation,
    };
  }

  summarize(): { simulationOnly: true; summary: string; generation: number; eventCount: number } {
    const stages = this.events.map((event) => event.phaseLabel).join(' → ') || '未開始';
    return {
      simulationOnly: true,
      summary: `架空の作業デモです。現在は${this.phaseLabel}です。これまでの場面: ${stages}。${this.changed} ${this.decision}`,
      generation: this.generation,
      eventCount: this.events.length,
    };
  }

  private get phaseLabel(): string {
    return phaseLabels[this.phase];
  }

  private nextOperationId(): string {
    this.operationSequence += 1;
    return `op-${String(this.operationSequence).padStart(4, '0')}`;
  }

  private recordStage(stage: StageDefinition, operationId: string): void {
    this.phase = stage.phase;
    this.generation += 1;
    this.updatedAt = new Date().toISOString();
    this.currentOperationId = operationId;
    this.currentWork = stage.currentWork;
    this.changed = stage.changed;
    this.decision = stage.decision;
    const evidence: Evidence = {
      id: `fictional-${this.generation}`,
      source: 'fictional-scenario',
      statement: stage.evidence,
    };
    this.events.push({
      eventId: `event-${this.generation}`,
      operationId,
      sequence: this.generation,
      sessionId: this.sessionId!,
      phase: stage.phase,
      phaseLabel: phaseLabels[stage.phase],
      createdAt: this.updatedAt,
      evidence: [evidence],
      dialogue: [
        { role: '実況', text: stage.lines[0], evidenceIds: [evidence.id] },
        { role: '解説', text: stage.lines[1], evidenceIds: [evidence.id] },
      ],
    });
  }

  private result(accepted: boolean, code: string, message: string, operationId: string): OperationResult {
    return { simulationOnly: true, accepted, code, message, operationId, snapshot: this.snapshot() };
  }
}

export function isTerminalStatus(status: LabStatus): status is 'finished' | 'stopped' {
  return isTerminal(status);
}
