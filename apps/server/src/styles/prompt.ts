import type { Event, Style } from "../types.js";

type CommentaryRole = "narration" | "explanation";

function styleDescriptor(style: Style): string {
  return style === "kansai"
    ? "関西弁で"
    : style === "zundamon"
      ? "ずんだもん風（〜なのだ）で"
      : "標準的な日本語で";
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

function buildPrompt(
  role: CommentaryRole,
  ev: Event,
  style: Style
): string {
  const roleLine =
    role === "narration"
      ? "あなたはCLI操作の実況者です。"
      : "あなたはCLI操作の解説者です。";
  const qualityRules =
    role === "narration"
      ? [
          "出力は1文だけ。",
          "短く、即時性重視。",
          "観測できる事実ベースで書く。",
          "意図、感情、成功見込み、未確認の原因を決めつけない。",
        ]
      : [
          "出力は1文だけ。",
          "初心者向けの補足にする。",
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
    `${roleLine}${styleDescriptor(style)}話してください。`,
    "品質ルール:",
    ...qualityRules.map((rule) => `- ${rule}`),
    `イベント別の指示: ${eventGuidance}`,
    ...(role === "explanation" ? [`説明の組み立て: ${explanationStructureHint(ev)}`] : []),
    ...(ambiguity ? [`曖昧さの扱い: ${ambiguity}`] : []),
    buildCommonEventSection(ev),
    answerLine,
  ].join("\n");
}

export function buildNarrationPrompt(ev: Event, style: Style): string {
  return buildPrompt("narration", ev, style);
}

export function buildExplanationPrompt(ev: Event, style: Style): string {
  return buildPrompt("explanation", ev, style);
}

export function normalizeGeneratedCommentaryText(
  text: string,
  role: CommentaryRole
): string {
  const compact = text.replace(/\s+/g, " ").trim();
  const stripped = compact.replace(/^(実況|解説|補足|1行メモ)[:：]\s*/u, "").trim();
  const firstSentence = stripped.match(/^.+?[。！？!?]/u)?.[0] ?? stripped;

  if (role === "explanation") {
    return firstSentence.replace(/^1行メモ:\s*/u, "").trim();
  }

  return firstSentence.trim();
}
