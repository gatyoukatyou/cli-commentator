/**
 * TTS (Text-to-Speech) utilities using Web Speech API
 * Sprint 24: cancel方式（最新のみ読み上げ）
 * Sprint 25: TTS設定（voice/rate/pitch/volume）
 * Sprint 26: 読み上げプリセット
 * Sprint 27: 順番待ち再生（ログ進行中も最後まで読み切る）
 */

/** TTS 設定 */
export type TTSEngine = "browser" | "voicevox";

export interface TTSSettings {
  engine: TTSEngine;
  voiceURI: string | null; // null = default voice
  rate: number;   // 0.1 - 10 (default: 1.0)
  pitch: number;  // 0 - 2 (default: 1.0)
  volume: number; // 0 - 1 (default: 1.0)
  voicevoxBaseUrl: string;
  voicevoxSpeaker: number;
  includeRawDetail: boolean; // true = read detected raw detail after commentary
}

export type TTSPresetId = "balanced" | "calm" | "clear";
type TTSPresetCore = Pick<TTSSettings, "rate" | "pitch" | "volume">;

export type TTSPreset = {
  id: TTSPresetId;
  label: string;
  description: string;
  settings: TTSPresetCore;
};

export const TTS_PRESETS: TTSPreset[] = [
  {
    id: "balanced",
    label: "標準（推奨）",
    description: "聞き取り重視の基準値",
    settings: { rate: 0.95, pitch: 1.0, volume: 1.0 },
  },
  {
    id: "calm",
    label: "ゆっくり",
    description: "速度を落として落ち着いた読み上げ",
    settings: { rate: 0.85, pitch: 0.95, volume: 0.9 },
  },
  {
    id: "clear",
    label: "はっきり",
    description: "少し高め/速めで明瞭さを優先",
    settings: { rate: 1.05, pitch: 1.1, volume: 1.0 },
  },
];

const DEFAULT_TTS_PRESET_ID: TTSPresetId = "balanced";
const DEFAULT_TTS_PRESET = TTS_PRESETS.find((preset) => preset.id === DEFAULT_TTS_PRESET_ID) ?? TTS_PRESETS[0];
export const DEFAULT_VOICEVOX_BASE_URL = "http://127.0.0.1:50021";
export const DEFAULT_VOICEVOX_SPEAKER = 1;

/** デフォルト設定（preset: balanced） */
export const DEFAULT_TTS_SETTINGS: TTSSettings = {
  engine: "browser",
  voiceURI: null,
  rate: DEFAULT_TTS_PRESET.settings.rate,
  pitch: DEFAULT_TTS_PRESET.settings.pitch,
  volume: DEFAULT_TTS_PRESET.settings.volume,
  voicevoxBaseUrl: DEFAULT_VOICEVOX_BASE_URL,
  voicevoxSpeaker: DEFAULT_VOICEVOX_SPEAKER,
  includeRawDetail: false,
};

export function applyTTSPreset(settings: TTSSettings, presetId: TTSPresetId): TTSSettings {
  const preset = TTS_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) return settings;
  return {
    ...settings,
    ...preset.settings,
  };
}

function nearlyEqual(a: number, b: number, epsilon = 0.001): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function detectTTSPreset(settings: TTSSettings): TTSPresetId | null {
  const matched = TTS_PRESETS.find((preset) =>
    nearlyEqual(settings.rate, preset.settings.rate) &&
    nearlyEqual(settings.pitch, preset.settings.pitch) &&
    nearlyEqual(settings.volume, preset.settings.volume)
  );
  return matched?.id ?? null;
}

const ANSI_COLOR_CODE_RE = /\[(?:\d{1,3};)*\d{1,3}m/g;
const BOX_DRAWING_CHARS_RE = /[─│┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬═║]+/g;
const CLI_DECORATIVE_SYMBOLS_RE =
  /(?:⏺|⎿|✅|✓|✔|✗|✘|➜|➤|●|○|◉|◎|■|□|▪|▫|►|▶|◀|◁|★|☆|❯|❮|⚡|⚠️|🔴|🟢|🟡|⬛|⬜)+/gu;
let activeVoicevoxAudio: HTMLAudioElement | null = null;
let activeVoicevoxAbort: AbortController | null = null;
let activeVoicevoxObjectUrl: string | null = null;
let activeBrowserUtterance: SpeechSynthesisUtterance | null = null;
let speechQueueGeneration = 0;
let speechQueueProcessing = false;

type QueuedSpeech = {
  text: string;
  settings: TTSSettings;
  lang: string;
  generation: number;
};

const speechQueue: QueuedSpeech[] = [];

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
  speechQueueGeneration += 1;
  speechQueue.length = 0;
  activeBrowserUtterance = null;
  if (isTTSSupported()) {
    speechSynthesis.cancel();
  }
  activeVoicevoxAbort?.abort();
  activeVoicevoxAbort = null;
  if (activeVoicevoxAudio) {
    activeVoicevoxAudio.pause();
    activeVoicevoxAudio.src = "";
    activeVoicevoxAudio = null;
  }
  if (activeVoicevoxObjectUrl) {
    URL.revokeObjectURL(activeVoicevoxObjectUrl);
    activeVoicevoxObjectUrl = null;
  }
}

function normalizeVoicevoxBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return (trimmed || DEFAULT_VOICEVOX_BASE_URL).replace(/\/+$/, "");
}

function clampVoicevoxSpeaker(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_VOICEVOX_SPEAKER;
  }
  return Math.floor(value);
}

function cleanupVoicevoxPlayback(audio?: HTMLAudioElement | null, objectUrl?: string | null): void {
  if (audio && activeVoicevoxAudio === audio) {
    activeVoicevoxAudio = null;
  }
  if (objectUrl && activeVoicevoxObjectUrl === objectUrl) {
    URL.revokeObjectURL(objectUrl);
    activeVoicevoxObjectUrl = null;
  }
  if (!audio && activeVoicevoxAudio) {
    activeVoicevoxAudio.pause();
    activeVoicevoxAudio.src = "";
    activeVoicevoxAudio = null;
  }
  if (!objectUrl && activeVoicevoxObjectUrl) {
    URL.revokeObjectURL(activeVoicevoxObjectUrl);
    activeVoicevoxObjectUrl = null;
  }
}

async function speakWithVoicevox(text: string, settings: TTSSettings): Promise<void> {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;

  const baseUrl = normalizeVoicevoxBaseUrl(settings.voicevoxBaseUrl);
  const speaker = clampVoicevoxSpeaker(settings.voicevoxSpeaker);
  const controller = new AbortController();
  activeVoicevoxAbort = controller;

  const queryResponse = await fetch(
    `${baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
    {
      method: "POST",
      signal: controller.signal,
    }
  );
  if (!queryResponse.ok) {
    throw new Error(`VOICEVOX audio_query failed: ${queryResponse.status}`);
  }

  const audioQuery = await queryResponse.json() as Record<string, unknown>;
  audioQuery.speedScale = settings.rate;
  audioQuery.volumeScale = settings.volume;
  audioQuery.pitchScale = settings.pitch - 1;

  const synthesisResponse = await fetch(`${baseUrl}/synthesis?speaker=${speaker}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(audioQuery),
    signal: controller.signal,
  });
  if (!synthesisResponse.ok) {
    throw new Error(`VOICEVOX synthesis failed: ${synthesisResponse.status}`);
  }

  const audioBlob = await synthesisResponse.blob();
  cleanupVoicevoxPlayback();
  const objectUrl = URL.createObjectURL(audioBlob);
  activeVoicevoxObjectUrl = objectUrl;

  const audio = new Audio(objectUrl);
  audio.volume = settings.volume;
  activeVoicevoxAudio = audio;
  await new Promise<void>((resolve, reject) => {
    const finalize = () => {
      if (activeVoicevoxAbort === controller) {
        activeVoicevoxAbort = null;
      }
      cleanupVoicevoxPlayback(audio, objectUrl);
      resolve();
    };
    const fail = (error: unknown) => {
      if (activeVoicevoxAbort === controller) {
        activeVoicevoxAbort = null;
      }
      cleanupVoicevoxPlayback(audio, objectUrl);
      reject(error);
    };

    controller.signal.addEventListener(
      "abort",
      () => {
        finalize();
      },
      { once: true }
    );
    audio.addEventListener("ended", finalize, { once: true });
    audio.addEventListener(
      "error",
      () => {
        fail(new Error("VOICEVOX audio playback failed"));
      },
      { once: true }
    );

    void audio.play().catch(fail);
  });
}

function speakWithBrowser(text: string, settings: TTSSettings, lang: string): Promise<void> {
  if (!isTTSSupported()) return Promise.resolve();

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    activeBrowserUtterance = utterance;
    utterance.lang = lang;
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;

    if (settings.voiceURI) {
      const voices = speechSynthesis.getVoices();
      const voice = voices.find((candidate) => candidate.voiceURI === settings.voiceURI);
      if (voice) {
        utterance.voice = voice;
      }
    }

    const finalize = () => {
      if (activeBrowserUtterance === utterance) {
        activeBrowserUtterance = null;
      }
      resolve();
    };

    utterance.onend = finalize;
    utterance.onerror = () => {
      finalize();
    };

    speechSynthesis.speak(utterance);
  });
}

async function processSpeechQueue(): Promise<void> {
  if (speechQueueProcessing) return;
  speechQueueProcessing = true;

  try {
    while (speechQueue.length > 0) {
      const next = speechQueue.shift();
      if (!next) continue;
      if (next.generation !== speechQueueGeneration) {
        continue;
      }

      try {
        if (next.settings.engine === "voicevox") {
          await speakWithVoicevox(next.text, next.settings);
        } else {
          await speakWithBrowser(next.text, next.settings, next.lang);
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.debug("speech playback failed", error);
        }
      }
    }
  } finally {
    speechQueueProcessing = false;
    if (speechQueue.length > 0) {
      void processSpeechQueue();
    }
  }
}

/**
 * 読み上げ実行（queue方式：前の発話を維持したまま順番待ち）
 * @param text 読み上げるテキスト
 * @param options TTS設定（省略時はデフォルト）
 * @param lang 言語コード（デフォルト: ja-JP）
 */
export function speak(
  text: string,
  options: Partial<TTSSettings> = {},
  lang = "ja-JP"
): void {
  const normalized = normalizeForSpeech(text);
  if (!normalized) return;

  const settings = { ...DEFAULT_TTS_SETTINGS, ...options };
  speechQueue.push({
    text: normalized,
    settings,
    lang,
    generation: speechQueueGeneration,
  });
  void processSpeechQueue();
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
      engine: parsed.engine === "voicevox" ? "voicevox" : "browser",
      voiceURI: typeof parsed.voiceURI === "string" ? parsed.voiceURI : null,
      rate: clamp(parsed.rate, 0.1, 10, DEFAULT_TTS_SETTINGS.rate),
      pitch: clamp(parsed.pitch, 0, 2, DEFAULT_TTS_SETTINGS.pitch),
      volume: clamp(parsed.volume, 0, 1, DEFAULT_TTS_SETTINGS.volume),
      voicevoxBaseUrl:
        typeof parsed.voicevoxBaseUrl === "string" && parsed.voicevoxBaseUrl.trim()
          ? parsed.voicevoxBaseUrl.trim()
          : DEFAULT_TTS_SETTINGS.voicevoxBaseUrl,
      voicevoxSpeaker: clampVoicevoxSpeaker(parsed.voicevoxSpeaker),
      includeRawDetail: parsed.includeRawDetail === true,
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

export function resetTTSForTests(): void {
  stopSpeech();
  speechQueueProcessing = false;
}
