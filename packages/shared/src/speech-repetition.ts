export const REPEATED_PROGRESS_SPEECH_WINDOW_MS = 120_000;

const QUOTED_TARGET_RE = /[「『“"]([^」』”"]{2,})[」』”"]/u;
const STYLE_ENDING_RE =
  /(?:という|っちゅう)?(?:ログ|文字|出力)?(?:が)?(?:出てきた|表示された|表示されました|出ています|出た)?(?:で|ですわ|や|な|なのだ|のだ|です)?$/u;
const QUOTED_OBSERVATION_CONTEXT_RE =
  /^(?:お)?(?:画面に)?(?:という|っちゅう)?(?:ログ|文字|出力)?(?:が)?(?:出てきた|表示された|表示されました|出ています|出た)(?:で|ですわ|や|な|なのだ|のだ|です)?$/u;
const QUOTED_CONFIRMATION_CONTEXT_RE =
  /^を?確認(?:しています|しとる|している)(?:で|ですわ|や|な|なのだ|のだ|です)?$/u;
const PUNCTUATION_RE = /[。、，,.!！?？:：;；「」『』“”"'`〜～…]/gu;

function compact(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeQuotedContext(value: string): string {
  const withoutPunctuation = compact(value)
    .replace(PUNCTUATION_RE, "")
    .replace(/\s+/gu, "");
  if (QUOTED_OBSERVATION_CONTEXT_RE.test(withoutPunctuation)) {
    return "observation";
  }
  if (QUOTED_CONFIRMATION_CONTEXT_RE.test(withoutPunctuation)) {
    return "confirmation";
  }
  return withoutPunctuation.replace(STYLE_ENDING_RE, "");
}

export function normalizeSpeechRepetitionKey(text: string): string {
  const normalized = compact(text);
  const quotedTarget = normalized.match(QUOTED_TARGET_RE);
  if (quotedTarget?.index !== undefined) {
    const quotedContext = [
      normalized.slice(0, quotedTarget.index),
      normalized.slice(quotedTarget.index + quotedTarget[0].length),
    ].join(" ");
    return `quoted:${compact(quotedTarget[1])}|context:${normalizeQuotedContext(quotedContext)}`;
  }

  const withoutPunctuation = normalized
    .replace(PUNCTUATION_RE, "")
    .replace(/\s+/gu, "");
  return `text:${withoutPunctuation.replace(STYLE_ENDING_RE, "")}`;
}

export function countRepeatedSpeechWithinWindow(
  samples: ReadonlyArray<{ timestampMs: number; text: string }>
): number {
  const lastSeen = new Map<string, number>();
  let repeats = 0;

  for (const sample of samples) {
    const key = normalizeSpeechRepetitionKey(sample.text);
    const previous = lastSeen.get(key);
    const elapsed = previous === undefined ? null : sample.timestampMs - previous;
    if (
      elapsed !== null &&
      elapsed >= 0 &&
      elapsed <= REPEATED_PROGRESS_SPEECH_WINDOW_MS
    ) {
      repeats += 1;
    }
    lastSeen.set(key, sample.timestampMs);
  }
  return repeats;
}
