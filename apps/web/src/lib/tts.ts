/**
 * TTS (Text-to-Speech) utilities using Web Speech API
 * Sprint 24: cancel方式（当時の最新のみ読み上げ）
 * Sprint 25: TTS設定（voice/rate/pitch/volume）
 * Sprint 26: 読み上げプリセット
 * #309: 優先度つき読み上げ（urgent割り込み / noticeキュー / progress待機置換）
 */

import {
  createSpeechScheduler,
  type ScheduledSpeech,
  type SpeechCancellationReason,
  type SpeechQueueClass,
} from "./speech-scheduler";
import { createSpeechLifecycleRecorder, type SpeechLifecycleExport } from "./speech-lifecycle";
import type { EventPriority } from "../types";

/** TTS 設定 */
export interface TTSSettings {
  voiceURI: string | null; // null = default voice
  rate: number;   // 0.1 - 10 (default: 1.0)
  pitch: number;  // 0 - 2 (default: 1.0)
  volume: number; // 0 - 1 (default: 1.0)
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

/** デフォルト設定（preset: balanced） */
export const DEFAULT_TTS_SETTINGS: TTSSettings = {
  voiceURI: null,
  rate: DEFAULT_TTS_PRESET.settings.rate,
  pitch: DEFAULT_TTS_PRESET.settings.pitch,
  volume: DEFAULT_TTS_PRESET.settings.volume,
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
const TTS_PRONUNCIATION_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/要確認/gu, "ようかくにん"],
  [/要対応/gu, "ようたいおう"],
];

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
 * テキスト正規化（ログ記号除去）。
 * 長さで切り捨てず、必要な場合の分割は splitForSpeech で行う。
 */
export function normalizeForSpeech(text: string): string {
  const cleaned = TTS_PRONUNCIATION_REPLACEMENTS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    stripControlChars(text)
      .replace(ANSI_COLOR_CODE_RE, "") // ANSI color payload remnants after ESC stripping
      .replace(BOX_DRAWING_CHARS_RE, "") // Box drawing characters
      .replace(CLI_DECORATIVE_SYMBOLS_RE, "") // CLI decorative symbols
      .replace(/\n{2,}/g, "\n") // 連続改行
      .trim()
  );

  return cleaned;
}

/**
 * Web Speech APIへ渡す安全な長さの発話単位へ分割する。
 * 分割位置は句読点・空白を優先するが、チャンク連結で正規化後の全文を
 * 完全に復元できるよう、文字を黙って削除しない。
 */
export function splitForSpeech(text: string, maxLength = 500): string[] {
  const normalized = normalizeForSpeech(text);
  if (!normalized) return [];

  const limit = Number.isFinite(maxLength) ? Math.max(1, Math.floor(maxLength)) : 500;
  const characters = Array.from(normalized);
  const chunks: string[] = [];
  let offset = 0;

  while (offset < characters.length) {
    const remaining = characters.length - offset;
    if (remaining <= limit) {
      chunks.push(characters.slice(offset).join(""));
      break;
    }

    let chunkLength = limit;
    const preferredMinimum = Math.max(1, Math.floor(limit * 0.6));
    for (let index = limit; index >= preferredMinimum; index -= 1) {
      if (/[\s。！？!?、,，；;：:]/u.test(characters[offset + index - 1] ?? "")) {
        chunkLength = index;
        break;
      }
    }

    chunks.push(characters.slice(offset, offset + chunkLength).join(""));
    offset += chunkLength;
  }

  return chunks;
}

type SpeakOptions = {
  settings: Partial<TTSSettings>;
  lang: string;
};

const lifecycleRecorder = createSpeechLifecycleRecorder();
type ActiveSpeech = {
  request: ScheduledSpeech<SpeakOptions>;
  chunks: string[];
  chunkIndex: number;
  spokenOffset: number;
  started: boolean;
};
const activeSpeech = new Map<string, ActiveSpeech>();
let speechId = 0;

const scheduler = createSpeechScheduler<SpeakOptions>({
  cancel(reason: SpeechCancellationReason, causeSpeechId?: string) {
    for (const request of activeSpeech.values()) {
      lifecycleRecorder.record({
        kind: "cancelled",
        speechId: request.request.id,
        priority: request.request.priority,
        text: request.request.text,
        reason,
        causeSpeechId,
      });
    }
    activeSpeech.clear();
    if (isTTSSupported()) speechSynthesis.cancel();
  },
  speak(request, onSettled) {
    const { settings: options, lang } = request.opts;
    const settings = { ...DEFAULT_TTS_SETTINGS, ...options };
    const chunks = splitForSpeech(request.text);
    if (chunks.length === 0) {
      onSettled();
      return;
    }

    const active: ActiveSpeech = {
      request,
      chunks,
      chunkIndex: 0,
      spokenOffset: 0,
      started: false,
    };
    activeSpeech.set(request.id, active);
    lifecycleRecorder.record({
      kind: "queued",
      speechId: request.id,
      priority: request.priority,
      text: request.text,
      reason: request.queueReason,
      queueDepth: request.queueDepth,
    });

    const speakChunk = (): void => {
      const current = activeSpeech.get(request.id);
      if (!current) return;

      const chunk = current.chunks[current.chunkIndex];
      if (!chunk) return;
      const utterance = new SpeechSynthesisUtterance(chunk);
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

      utterance.onstart = () => {
        const startedSpeech = activeSpeech.get(request.id);
        if (!startedSpeech || startedSpeech.started) return;
        startedSpeech.started = true;
        lifecycleRecorder.record({
          kind: "started",
          speechId: request.id,
          priority: request.priority,
          text: request.text,
        });
      };
      utterance.onboundary = (event) => {
        const speaking = activeSpeech.get(request.id);
        if (!speaking) return;
        lifecycleRecorder.updateProgress(request.id, speaking.spokenOffset + event.charIndex);
      };
      utterance.onend = () => {
        const finished = activeSpeech.get(request.id);
        if (!finished) return;
        finished.spokenOffset += chunk.length;
        if (finished.chunkIndex + 1 < finished.chunks.length) {
          finished.chunkIndex += 1;
          speakChunk();
          return;
        }

        activeSpeech.delete(request.id);
        lifecycleRecorder.record({
          kind: "ended",
          speechId: request.id,
          priority: request.priority,
          text: request.text,
        });
        onSettled();
      };
      utterance.onerror = (event) => {
        if (!activeSpeech.delete(request.id)) return;
        lifecycleRecorder.record({
          kind: "cancelled",
          speechId: request.id,
          priority: request.priority,
          text: request.text,
          reason: `speech_error:${event.error}`,
        });
        onSettled();
      };
      speechSynthesis.speak(utterance);
    };

    speakChunk();
  },
}, {
  nextId: () => `speech-${Date.now()}-${++speechId}`,
  onDropped(request, reason) {
    lifecycleRecorder.record({
      kind: reason === "progress_replace" ? "replaced" : "suppressed",
      speechId: request.id,
      priority: request.priority,
      text: request.text,
      reason,
      queueDepth: request.queueDepth,
    });
  },
});

function exportSettings(settings?: Partial<TTSSettings>): Record<string, unknown> | undefined {
  if (!settings) return undefined;
  return {
    voiceURI: settings.voiceURI ?? null,
    rate: settings.rate ?? DEFAULT_TTS_SETTINGS.rate,
    pitch: settings.pitch ?? DEFAULT_TTS_SETTINGS.pitch,
    volume: settings.volume ?? DEFAULT_TTS_SETTINGS.volume,
    includeRawDetail: settings.includeRawDetail === true,
  };
}

export function getTTSLifecycleLog(settings?: Partial<TTSSettings>): SpeechLifecycleExport {
  return lifecycleRecorder.export(exportSettings(settings));
}

export function resetTTSLifecycleLog(trigger = "manual_reset"): void {
  scheduler.cancel();
  lifecycleRecorder.reset(trigger);
}

export function downloadTTSLifecycleLog(settings?: Partial<TTSSettings>): SpeechLifecycleExport {
  const exported = getTTSLifecycleLog(settings);
  const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cli-commentator-tts-evaluation-${exported.exportedAt.replace(/[:.]/g, "-")}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return exported;
}

/** 読み上げ停止（待機中の発話・優先度状態も破棄） */
export function stopSpeech(): void {
  if (isTTSSupported()) {
    scheduler.cancel();
  }
}

/**
 * 優先度つき読み上げ
 * - urgent: 進行中の発話に割り込む（従来のcancel方式と同じ即時性）
 * - notice: 進行中の発話を止めずキュー末尾に追加
 * - progress: 再生中は止めず、通常実況をFIFOで保持する。heartbeatは通常実況の後ろへ送る
 * @returns 読み上げをキューに積んだら true、間引いた場合は false
 */
export function speakWithPriority(
  text: string,
  priority: EventPriority,
  options: Partial<TTSSettings> = {},
  lang = "ja-JP",
  queueClass: SpeechQueueClass = "normal"
): boolean {
  if (!isTTSSupported()) return false;

  const normalized = normalizeForSpeech(text);
  if (!normalized) return false;

  return scheduler.speak(priority, normalized, { settings: options, lang }, queueClass);
}

/**
 * 読み上げ実行（urgent扱い：前の発話へ割り込む）
 * ユーザー操作起点（開始アナウンス・テスト読み上げ）用。urgent扱いで割り込む。
 * @param text 読み上げるテキスト
 * @param options TTS設定（省略時はデフォルト）
 * @param lang 言語コード（デフォルト: ja-JP）
 */
export function speak(
  text: string,
  options: Partial<TTSSettings> = {},
  lang = "ja-JP"
): void {
  speakWithPriority(text, "urgent", options, lang);
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
