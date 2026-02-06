/**
 * TTS (Text-to-Speech) utilities using Web Speech API
 * Sprint 24: cancel方式（最新のみ読み上げ）
 * Sprint 25: TTS設定（voice/rate/pitch/volume）
 */

/** TTS 設定 */
export interface TTSSettings {
  voiceURI: string | null; // null = default voice
  rate: number;   // 0.1 - 10 (default: 1.0)
  pitch: number;  // 0 - 2 (default: 1.0)
  volume: number; // 0 - 1 (default: 1.0)
}

/** デフォルト設定 */
export const DEFAULT_TTS_SETTINGS: TTSSettings = {
  voiceURI: null,
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
};

const ANSI_COLOR_CODE_RE = /\[(?:\d{1,3};)*\d{1,3}m/g;
const BOX_DRAWING_CHARS_RE = /[─│┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬═║]+/g;
const CLI_DECORATIVE_SYMBOLS_RE =
  /(?:⏺|⎿|✅|✓|✔|✗|✘|➜|➤|●|○|◉|◎|■|□|▪|▫|►|▶|◀|◁|★|☆|❯|❮|⚡|⚠️|🔴|🟢|🟡|⬛|⬜)+/gu;

function stripControlChars(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x09 || c === 0x0a || c === 0x0d) {
      out += s[i];
      continue;
    }
    if (c <= 0x1f || c === 0x7f || (c >= 0x80 && c <= 0x9f)) {
      continue;
    }
    out += s[i];
  }
  return out;
}

/** TTS サポート判定 */
export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * 利用可能な音声リストを取得
 * 注意: 音声リストは非同期でロードされる場合がある（特にChrome）
 */
export function getVoices(): SpeechSynthesisVoice[] {
  if (!isTTSSupported()) return [];
  return speechSynthesis.getVoices();
}

/**
 * 音声リストの読み込みを待機
 * Chrome等では初回呼び出し時に空配列が返るため、onvoiceschanged を待つ
 */
export function waitForVoices(timeoutMs = 3000): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!isTTSSupported()) {
      resolve([]);
      return;
    }

    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }

    // 音声がまだロードされていない場合、イベントを待つ
    // 既存ハンドラを退避してチェーン
    const prevHandler = speechSynthesis.onvoiceschanged;
    let resolved = false;

    const cleanup = () => {
      speechSynthesis.onvoiceschanged = prevHandler;
    };

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(speechSynthesis.getVoices());
      }
    }, timeoutMs);

    speechSynthesis.onvoiceschanged = (ev) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        cleanup();
        resolve(speechSynthesis.getVoices());
      }
      // 元のハンドラも呼ぶ
      if (prevHandler) {
        prevHandler.call(speechSynthesis, ev);
      }
    };
  });
}

/**
 * テキスト正規化（ログ記号除去、長さ制限）
 */
export function normalizeForSpeech(text: string, maxLength = 500): string {
  const cleaned = stripControlChars(text)
    .replace(ANSI_COLOR_CODE_RE, "") // ANSI color payload remnants after ESC stripping
    .replace(BOX_DRAWING_CHARS_RE, "") // Box drawing characters
    .replace(CLI_DECORATIVE_SYMBOLS_RE, "") // CLI decorative symbols
    .replace(/\n{2,}/g, "\n") // 連続改行
    .trim();

  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) + "..." : cleaned;
}

/** 読み上げ停止 */
export function stopSpeech(): void {
  if (isTTSSupported()) {
    speechSynthesis.cancel();
  }
}

/**
 * 読み上げ実行（cancel方式：前の発話をキャンセルして最新のみ）
 * @param text 読み上げるテキスト
 * @param options TTS設定（省略時はデフォルト）
 * @param lang 言語コード（デフォルト: ja-JP）
 */
export function speak(
  text: string,
  options: Partial<TTSSettings> = {},
  lang = "ja-JP"
): void {
  if (!isTTSSupported()) return;

  speechSynthesis.cancel(); // 前の発話をキャンセル

  const normalized = normalizeForSpeech(text);
  if (!normalized) return;

  const settings = { ...DEFAULT_TTS_SETTINGS, ...options };

  const utterance = new SpeechSynthesisUtterance(normalized);
  utterance.lang = lang;
  utterance.rate = settings.rate;
  utterance.pitch = settings.pitch;
  utterance.volume = settings.volume;

  // 指定された音声を設定
  if (settings.voiceURI) {
    const voices = speechSynthesis.getVoices();
    const voice = voices.find((v) => v.voiceURI === settings.voiceURI);
    if (voice) {
      utterance.voice = voice;
    }
  }

  speechSynthesis.speak(utterance);
}

// localStorage キー
const TTS_ENABLED_KEY = "cli-commentator-tts-enabled";
const TTS_SETTINGS_KEY = "cli-commentator-tts-settings";

/** localStorage から TTS 有効状態を取得 */
export function getTTSEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(TTS_ENABLED_KEY) === "true";
}

/** localStorage に TTS 有効状態を保存 */
export function setTTSEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(TTS_ENABLED_KEY, String(enabled));
}

/** 数値をクランプ */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/** localStorage から TTS 設定を取得（サニタイズ付き） */
export function getTTSSettings(): TTSSettings {
  if (typeof localStorage === "undefined") return DEFAULT_TTS_SETTINGS;
  try {
    const stored = localStorage.getItem(TTS_SETTINGS_KEY);
    if (!stored) return DEFAULT_TTS_SETTINGS;
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return {
      voiceURI: typeof parsed.voiceURI === "string" ? parsed.voiceURI : null,
      rate: clamp(parsed.rate, 0.1, 10, DEFAULT_TTS_SETTINGS.rate),
      pitch: clamp(parsed.pitch, 0, 2, DEFAULT_TTS_SETTINGS.pitch),
      volume: clamp(parsed.volume, 0, 1, DEFAULT_TTS_SETTINGS.volume),
    };
  } catch {
    return DEFAULT_TTS_SETTINGS;
  }
}

/** localStorage に TTS 設定を保存 */
export function setTTSSettings(settings: TTSSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TTS_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage full or unavailable - fail silently
  }
}
