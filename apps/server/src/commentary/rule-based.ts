import type { CommentaryMode, CommentaryPayload, Event, Style } from "../types.js";
import { isCodexProgressNoise, isTerminalRenderingNoise } from "../progress-noise.js";
import { commentStandard } from "../styles/standard.js";
import { commentKansai } from "../styles/kansai.js";
import { commentZundamon } from "../styles/zundamon.js";
import { describeBashMeaning, detailCommand, say } from "./bash-meaning.js";
import { beginnerOneLine } from "./beginner-lines.js";
import { getGlossaryNotes } from "./glossary.js";
import { describeNarrationSubject, type NarrationSubject } from "./narration-subject.js";
import { SESSION_PHASE_LABELS, type SessionContextSnapshot } from "../session-context.js";

const COMMENTERS: Record<Style, (ev: Event, subject: NarrationSubject) => string> = {
  standard: commentStandard,
  kansai: commentKansai,
  zundamon: commentZundamon,
};

const DETAIL_PREVIEW_MAX = 96;

const HERMES_EXPLANATIONS: Record<string, string> = {
  "Hermes Agentセッションを開始した": "Hermesのセッションを開始し、指示や応答を受け付ける準備をしています。",
  "Hermesの入力を待っている": "入力待ちです。次の指示を受け取るまで処理は進みません。",
  "Hermesが応答をストリーミングしている": "モデルの応答を少しずつ受け取り、表示を更新しています。",
  "ターミナルツールを実行している": "ターミナルの結果を受け取り、次の処理を判断しています。",
  "Webツールを実行している": "Webから情報を取得し、次の判断材料を集めています。",
  "スキルを読み込んでいる": "必要なスキルの定義を読み込み、使える手順を確認しています。",
  "Hermesのコマンドを実行している": "コマンドの実行結果を待ち、処理を続けるか判断しています。",
  "Hermesの承認を待っている": "安全確認のため、次の操作を実行してよいか入力を待っています。",
  "Hermesのスラッシュコマンドを実行している": "セッション設定に関わるコマンドを処理しています。",
  "Hermesの処理を中断した": "ユーザーの中断を受け付け、現在の処理を止めています。",
  "Hermesの応答が完了した": "応答の生成が一区切りつき、結果を確認できる状態です。",
  "Hermesセッションを終了した": "Hermesセッションが終了し、処理が止まっています。",
  "Hermesでエラーが発生している": "Hermesの処理で問題が起き、原因を確認する必要があります。",
};

const GENERIC_STATUS_CHROME_RE = /^(?:\?\s+for\s+shortcuts|esc\s+to\s+interrupt|try\s+"[^"]*"|manual\s+mode\s+on|connecting…?|[^\p{L}\p{N}]*(?:analyzing|formulating|brainstorming|reflecting|synthesizing|pondering|contemplating|thinking|working)(?:\b|!).*(?:\.\.\.|…).*|\d+\s*s\b.*\box\s+alpha\w*\b.*)$/iu;

function detailPreview(detail?: string): string {
  if (!detail) return "";
  const compact = detail.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= DETAIL_PREVIEW_MAX) return compact;
  return `${compact.slice(0, DETAIL_PREVIEW_MAX - 1).trimEnd()}…`;
}

function detailSpotlight(ev: Event, style: Style): string {
  const preview = detailPreview(ev.detail);
  if (!preview) return "";

  if (ev.type === "stdout") {
    if (/^[⏺•]\s*Bash\(/.test(ev.detail ?? "")) {
      return describeBashMeaning(detailCommand(ev.detail), style).spotlight;
    }
    return say(style, {
      standard: `今見えている出力は「${preview}」です。`,
      kansai: `今見えてる出力は「${preview}」や。`,
      zundamon: `今見えてる出力は「${preview}」なのだ。`,
    });
  }

  if (ev.type === "stderr" || ev.type === "error") {
    return say(style, {
      standard: `引っかかっている行は「${preview}」です。`,
      kansai: `引っかかってる行は「${preview}」や。`,
      zundamon: `引っかかってる行は「${preview}」なのだ。`,
    });
  }

  return "";
}

function isLowValueGenericOutput(ev: Event): boolean {
  if (ev.type !== "stdout" || ev.summary !== "ログ更新") return false;
  const detail = ev.detail?.trim() ?? "";
  // Keep the existing fallback behaviour for a detail-less generic event.
  // There is no redraw text to identify here, and callers/tests rely on the
  // ruleset still producing a normal generic narration for it.
  if (!detail) return false;
  return (
    isCodexProgressNoise(detail) ||
    isTerminalRenderingNoise(detail) ||
    GENERIC_STATUS_CHROME_RE.test(detail)
  );
}

function hermesExplanation(ev: Event): string | undefined {
  return HERMES_EXPLANATIONS[ev.summary];
}

function genericOutputExplanation(ev: Event): string | undefined {
  if (ev.type !== "stdout" || ev.summary !== "ログ更新" || isLowValueGenericOutput(ev)) {
    return undefined;
  }
  if (!ev.detail?.trim()) return undefined;
  return "CLIからの出力を受け取り、現在の処理状況を確認しています。";
}

function inferCommentaryMode(payload: CommentaryPayload): CommentaryMode {
  if (payload.narration && payload.explanation) return "both";
  if (payload.explanation) return "explanation";
  return "narration";
}

export function isSuppressedCommentaryEvent(ev: Event): boolean {
  return isLowValueGenericOutput(ev);
}

export function withCommentaryMode(payload: CommentaryPayload): CommentaryPayload {
  return {
    ...payload,
    meta: {
      ...payload.meta,
      mode: payload.meta?.mode ?? inferCommentaryMode(payload),
    },
  };
}

function contextNarration(context: SessionContextSnapshot, style: Style): string {
  const phase = SESSION_PHASE_LABELS[context.phase];
  const target = context.target ? `「${context.target}」` : "対象";

  if (context.phaseChanged) {
    if (context.humanRequired) {
      return say(style, {
        standard: `${phase}段階に入り、HUMANの入力を待っています。`,
        kansai: `${phase}段階に入って、HUMANの入力待ちや。`,
        zundamon: `${phase}段階に入って、HUMANの入力待ちなのだ。`,
      });
    }
    if (context.phase === "waiting") {
      return say(style, {
        standard: "処理は続いています。次の出力を待っています。",
        kansai: "処理は続いてるで。次の出力を待ってるところや。",
        zundamon: "処理は続いているのだ。次の出力を待っているのだ。",
      });
    }
    return say(style, {
      standard: `${phase}段階に入り、${target}を扱っています。`,
      kansai: `${phase}段階に入って、${target}を扱ってるで。`,
      zundamon: `${phase}段階に入って、${target}を扱ってるのだ。`,
    });
  }

  const currentEvent = context.recentEvents.at(-1);
  const previousEvent = context.recentEvents.at(-2);
  const targetChanged = currentEvent?.target !== previousEvent?.target;
  if (
    context.target &&
    targetChanged &&
    ["read", "search", "write", "test", "lint", "build"].includes(currentEvent?.type ?? "")
  ) {
    return say(style, {
      standard: `現在の対象は${target}です。`,
      kansai: `今の対象は${target}や。`,
      zundamon: `今の対象は${target}なのだ。`,
    });
  }
  return "";
}

function contextExplanation(
  beginner: string,
  context?: SessionContextSnapshot
): string | undefined {
  if (!beginner && !context) return undefined;
  if (!context || context.phase === "unknown") return beginner || undefined;

  const phase = SESSION_PHASE_LABELS[context.phase];
  const objective = context.task.objective;
  if (context.phase === "waiting" && context.phaseChanged) {
    return context.humanRequired
      ? "作業を進めるには、ターミナルでの入力が必要です。"
      : "エラーではありません。処理を続けながら、次の出力を待っている状態です。";
  }
  if (objective && context.phaseChanged) {
    const purpose = objective.length <= 32 ? objective : `${objective.slice(0, 31).trimEnd()}…`;
    return `目的「${purpose}」に向けた${phase}段階です。`;
  }
  return beginner || undefined;
}

function codexTuiNarration(ev: Event, style: Style): string {
  if (ev.summary === "Codexが説明している") {
    return say(style, {
      standard: "Codexが作業内容を説明しています。",
      kansai: "Codexが作業内容を説明してるで。",
      zundamon: "Codexが作業内容を説明してるのだ。",
    });
  }
  if (ev.summary === "Codexが回答した") {
    return say(style, {
      standard: "Codexが回答しました。",
      kansai: "Codexが回答したで。",
      zundamon: "Codexが回答したのだ。",
    });
  }
  return "";
}

export function commentByRules(
  ev: Event,
  style: Style,
  context?: SessionContextSnapshot
): CommentaryPayload {
  if (isSuppressedCommentaryEvent(ev)) {
    return withCommentaryMode({
      meta: {
        narrationProvider: "rules",
        explanationProvider: "rules",
      },
    });
  }

  // The beginner explanation is the supervision layer, so it stays in plain
  // Japanese regardless of the selected entertainment/narration style.
  const beginner = beginnerOneLine(ev);
  const glossaryNotes = context ? [...context.glossaryNotes] : getGlossaryNotes(ev.detail, ev.type);
  const codexNarration = codexTuiNarration(ev, style);
  const spotlight = codexNarration ? "" : detailSpotlight(ev, style);

  const subject = describeNarrationSubject(ev);
  const core = codexNarration || COMMENTERS[style](ev, subject);
  const contextual = context ? contextNarration(context, style) : "";
  // A concrete subject names the same target in visible narration and speech;
  // the phase change is carried by the explanation instead.
  const lead = subject.kind !== "none" ? core : contextual || core;
  const explanation =
    hermesExplanation(ev) ??
    contextExplanation(beginner, context) ??
    genericOutputExplanation(ev);

  return withCommentaryMode({
    narration: [lead, spotlight].filter(Boolean).join(" "),
    explanation,
    glossaryNotes,
    meta: {
      narrationProvider: "rules",
      explanationProvider: "rules",
    },
  });
}
