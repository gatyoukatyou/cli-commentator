import type { Event, Style } from "../types.js";
import { SESSION_PHASE_LABELS, type SessionContextSnapshot } from "../session-context.js";

type CommentaryRole = "narration" | "explanation";

function narrationStyleDescriptor(style: Style): string {
  return style === "kansai"
    ? "関西弁で"
    : style === "zundamon"
      ? "ずんだもん風（〜なのだ）で"
      : "標準的な日本語で";
}

function deliveryDescriptor(role: CommentaryRole, style: Style): string {
  // The narration is the entertaining layer. The explanation is the stable
  // supervision layer, so it must stay plain even when a character style is selected.
  return role === "narration"
    ? narrationStyleDescriptor(style)
    : "口調プリセットに影響されない、平易で落ち着いた標準的な日本語で";
}

function isAmbiguousEvent(ev: Event): boolean {
  if (ev.detail?.trim()) {
    return false;
  }

  return /^(ログ更新|進行中|処理中|作業中|更新中|確認中)$/u.test(ev.summary.trim());
}

function narrationGuidance(ev: Event): string {
  switch (ev.type) {
    case "start":
      return "始まった対象だけを先に言い、意図や成功見込みは足さない。";
    case "stdout":
      return "見えている進行や表示内容だけを短く言い、背景説明は入れない。";
    case "stderr":
    case "error":
      return "問題発生を先に伝え、画面に出ている事実だけを述べる。";
    case "read":
      return "何を読んで確認しているかだけを述べ、深読みしない。";
    case "write":
      return "何を更新・適用しているかを動詞中心で短く述べる。";
    case "search":
      return "何を探しているかを手短に述べ、目的の断定は避ける。";
    case "test":
    case "lint":
    case "build":
      return "実行中のチェックや処理名を先に言い、評価や感想を足さない。";
    case "git":
    case "github":
      return "操作対象を先に言い、レビュー判断や感情を混ぜない。";
    case "install":
      return "入れているもの・準備しているものを短く述べる。";
    case "server":
      return "サーバー状態の変化だけを簡潔に述べる。";
    case "done":
      return "ひと区切りついた事実だけを短く伝える。";
    default:
      return "今観測できる作業だけを短く言う。";
  }
}

function explanationGuidance(ev: Event): string {
  switch (ev.type) {
    case "read":
      return "何を確認するための読み込みかと、そのファイルを読むと何が分かるかを初心者向けに補足する。";
    case "search":
      return "何を手がかりに確認範囲を絞っているかと、その検索で次に何を判断したいかを補足する。";
    case "write":
      return "何を変える段階なのか、なぜ更新していて更新後に何を確かめたいかを補足する。";
    case "test":
    case "lint":
    case "build":
      return "その確認や処理で何が分かるのか、通れば何を前に進められるかを補足する。";
    case "stderr":
    case "error":
      return "どこが詰まっていて、ログから言える範囲で次に何を確認すると前に進めるかを補足する。";
    case "git":
    case "github":
      return "変更確認や公開前確認として何を見る場面かと、その確認結果で何を決めるかを補足する。";
    case "stdout":
      return "実況の言い換えではなく、表示の意味・今の段階・この表示から次に判断できることを補足する。";
    case "done":
      return "区切り後に何を確認する段階か、次の一手が何かを補足する。";
    default:
      return "実況の言い換えを避け、今の作業の意味と次に見える判断材料を初心者向けに補足する。";
  }
}

function explanationStructureHint(ev: Event): string {
  if (ev.type === "stderr" || ev.type === "error") {
    return "『いま何が詰まっているか』を先に述べ、そのあとに『次に確認する対象』を短く添える。";
  }

  if (ev.type === "stdout" || ev.type === "read" || ev.type === "search") {
    return "『いま見ているもの』と『それで何が分かるか』を1文でつなぐ。";
  }

  if (ev.type === "test" || ev.type === "lint" || ev.type === "build") {
    return "『この確認で何が分かるか』を中心に述べ、通過/失敗後の判断に結びつける。";
  }

  return "『いまの作業』と『それで何が分かるか』を1文でつなぐ。";
}

function ambiguityGuidance(ev: Event, role: CommentaryRole): string {
  if (!isAmbiguousEvent(ev)) {
    return "";
  }

  return role === "narration"
    ? "詳細が足りないときは、断定せず『状況を確認している』程度に留める。"
    : "目的が断定できないときは、『詳細を確認している段階』のように不確実さを残す。";
}

function buildCommonEventSection(ev: Event): string {
  return [
    `イベント種別: ${ev.type}`,
    `要約: ${ev.summary}`,
    ev.detail ? `詳細: ${ev.detail}` : "詳細: （なし）",
  ].join("\n");
}

function buildContextSection(context?: SessionContextSnapshot): string {
  if (!context) return "";
  const recentFlow = context.recentEvents
    .slice(-3)
    .map((event) => `${event.type}:${event.summary}`)
    .join(" → ");
  return [
    "観測済みセッション文脈:",
    context.task.objective ? `- 確認済みの作業目的: ${context.task.objective}` : "- 作業目的: 不明",
    context.task.userPrompt ? `- 確認済みのHUMAN依頼: ${context.task.userPrompt}` : "- HUMAN依頼: 不明",
    ...(context.task.sessionLabel ? [`- 起動プリセット: ${context.task.sessionLabel}`] : []),
    `- 現在フェーズ: ${SESSION_PHASE_LABELS[context.phase]} (${context.phase})`,
    context.phaseChanged
      ? `- フェーズ変化: ${SESSION_PHASE_LABELS[context.previousPhase]} → ${SESSION_PHASE_LABELS[context.phase]}`
      : "- フェーズ変化: なし",
    `- 現在対象: ${context.target ?? "不明"}`,
    `- HUMAN対応: ${context.humanRequired ? "明示的に必要" : "明示されていない"}`,
    ...(recentFlow ? [`- 直近の流れ: ${recentFlow}`] : []),
    "この文脈は観測済みの事実だけとして使い、不明な目的・結果・成功見込みを補わない。",
  ].join("\n");
}

function buildPrompt(
  role: CommentaryRole,
  ev: Event,
  style: Style,
  context?: SessionContextSnapshot
): string {
  const roleLine =
    role === "narration"
      ? "あなたはCLI操作の実況者です。"
      : "あなたはCLI操作の解説者です。";
  const qualityRules =
    role === "narration"
      ? [
          "出力は1文だけ。",
          "日本語25〜30文字で、句読点・英数字・記号を含めて必ず30文字以内にする。",
          "入力や操作名の列挙より、観測された結果・状態変化を優先して伝える。",
          "対象名が長い場合は一般名詞へ言い換え、単語や文末を途中で切らない。",
          "観測できる事実ベースで書く。",
          "意図、感情、成功見込み、未確認の原因を決めつけない。",
        ]
      : [
          "出力は1文だけ。",
          "初心者向けの補足にする。",
          "イベントの目的を1つに絞り、複数の推測や工程を詰め込まない。",
          "実況の言い換えだけで終わらせない。",
          "観測できる事実から外れる推測はしない。",
          "できるだけ『何を見ていて』『それで何が分かるか』を一文にまとめる。",
        ];
  const eventGuidance =
    role === "narration" ? narrationGuidance(ev) : explanationGuidance(ev);
  const ambiguity = ambiguityGuidance(ev, role);
  const answerLine =
    role === "narration"
      ? "回答は実況コメント1文のみ。"
      : "回答は補足説明1文のみ。";

  return [
    `${roleLine}${deliveryDescriptor(role, style)}話してください。`,
    "品質ルール:",
    ...qualityRules.map((rule) => `- ${rule}`),
    `イベント別の指示: ${eventGuidance}`,
    ...(role === "explanation" ? [`説明の組み立て: ${explanationStructureHint(ev)}`] : []),
    ...(ambiguity ? [`曖昧さの扱い: ${ambiguity}`] : []),
    ...(context ? [buildContextSection(context)] : []),
    buildCommonEventSection(ev),
    answerLine,
  ].join("\n");
}

export function buildNarrationPrompt(
  ev: Event,
  style: Style,
  context?: SessionContextSnapshot
): string {
  return buildPrompt("narration", ev, style, context);
}

export function buildExplanationPrompt(
  ev: Event,
  style: Style,
  context?: SessionContextSnapshot
): string {
  return buildPrompt("explanation", ev, style, context);
}

export function normalizeGeneratedCommentaryText(
  text: string,
  role: CommentaryRole
): string {
  const repaired = text
    .replace(/今見えていてる(?=で(?:[、。！？!?]|$))/gu, "今見えてる")
    .replace(/今見えていてる/gu, "今見えている");
  const compact = repaired.replace(/\s+/g, " ").trim();
  const stripped = compact.replace(/^(実況|解説|補足|1行メモ)[:：]\s*/u, "").trim();
  const firstSentence = stripped.match(/^.+?[。！？!?]/u)?.[0] ?? stripped;

  if (role === "explanation") {
    return firstSentence.replace(/^1行メモ:\s*/u, "").trim();
  }

  return firstSentence.trim();
}
