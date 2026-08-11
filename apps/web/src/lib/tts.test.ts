import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TTS_SETTINGS,
  TTS_PRESETS,
  applyTTSPreset,
  detectTTSPreset,
  getTTSLifecycleLog,
  normalizeForSpeech,
  resetTTSLifecycleLog,
  speakWithPriority,
  splitForSpeech,
  type TTSSettings,
} from "./tts";

describe("TTS presets", () => {
  it("uses balanced preset as default settings", () => {
    const balanced = TTS_PRESETS.find((preset) => preset.id === "balanced");
    expect(balanced).toBeDefined();
    expect(DEFAULT_TTS_SETTINGS.rate).toBe(balanced?.settings.rate);
    expect(DEFAULT_TTS_SETTINGS.pitch).toBe(balanced?.settings.pitch);
    expect(DEFAULT_TTS_SETTINGS.volume).toBe(balanced?.settings.volume);
  });

  it("applies preset while preserving selected voice", () => {
    const current: TTSSettings = {
      voiceURI: "ja-JP-test-voice",
      rate: 1.2,
      pitch: 1.2,
      volume: 0.8,
      includeRawDetail: true,
    };

    const next = applyTTSPreset(current, "calm");
    expect(next.voiceURI).toBe("ja-JP-test-voice");
    expect(next.rate).toBe(0.85);
    expect(next.pitch).toBe(0.95);
    expect(next.volume).toBe(0.9);
    expect(next.includeRawDetail).toBe(true);
  });

  it("detects matching preset id from settings", () => {
    const preset = TTS_PRESETS.find((candidate) => candidate.id === "clear");
    if (!preset) throw new Error("clear preset not found");
    const settings: TTSSettings = {
      voiceURI: null,
      includeRawDetail: false,
      ...preset.settings,
    };
    expect(detectTTSPreset(settings)).toBe("clear");
  });

  it("returns null for custom settings", () => {
    const custom: TTSSettings = {
      voiceURI: null,
      rate: 0.92,
      pitch: 1.03,
      volume: 0.97,
      includeRawDetail: false,
    };
    expect(detectTTSPreset(custom)).toBeNull();
  });
});

describe("normalizeForSpeech", () => {
  it("表示用テキストを変更せずTTS向けの要語を読み補正する", () => {
    const displayText = "要確認です。要対応です：設定を見直します。";

    expect(normalizeForSpeech(displayText)).toBe(
      "ようかくにんです。ようたいおうです：設定を見直します。"
    );
    expect(displayText).toBe("要確認です。要対応です：設定を見直します。");
  });

  it("長文を切り捨てず、安全なチャンクへ分割して全文を復元できる", () => {
    const input = Array.from({ length: 18 }, (_, index) =>
      `実況${index}: 次の出力を確認しながら処理を続けています。`
    ).join("");
    const normalized = normalizeForSpeech(input);
    const chunks = splitForSpeech(input, 48);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 48)).toBe(true);
    expect(chunks.join("")).toBe(normalized);
  });

  it("長文の各チャンクを順番にTTSへ渡し、最後のendedまで全文を保持する", () => {
    type FakeUtterance = {
      text: string;
      onstart: (() => void) | null;
      onboundary: ((event: { charIndex: number }) => void) | null;
      onend: (() => void) | null;
      onerror: ((event: { error: string }) => void) | null;
    };
    class FakeSpeechSynthesisUtterance implements FakeUtterance {
      text: string;
      onstart: (() => void) | null = null;
      onboundary: ((event: { charIndex: number }) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      lang = "";
      rate = 1;
      pitch = 1;
      volume = 1;

      constructor(text: string) {
        this.text = text;
      }
    }

    const utterances: FakeUtterance[] = [];
    const fakeSpeechSynthesis = {
      getVoices: () => [],
      speak: (utterance: FakeUtterance) => utterances.push(utterance),
      cancel: vi.fn(),
    };
    vi.stubGlobal("window", { speechSynthesis: fakeSpeechSynthesis });
    vi.stubGlobal("speechSynthesis", fakeSpeechSynthesis);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeSpeechSynthesisUtterance);
    resetTTSLifecycleLog("long_text_test");
    fakeSpeechSynthesis.cancel.mockClear();

    const input = Array.from({ length: 24 }, (_, index) =>
      `長文実況${index}: 画面に表示した内容を最後まで順番に読み上げます。`
    ).join("");
    const normalized = normalizeForSpeech(input);
    const firstChunkCount = splitForSpeech(input).length;
    expect(speakWithPriority(input, "progress")).toBe(true);
    expect(speakWithPriority("次の通常実況も待機させます。", "progress")).toBe(true);
    expect(utterances).toHaveLength(1);

    for (let index = 0; index < firstChunkCount; index += 1) {
      const utterance = utterances[index];
      utterance.onstart?.();
      utterance.onboundary?.({ charIndex: utterance.text.length });
      utterance.onend?.();
    }

    expect(utterances.length).toBe(firstChunkCount + 1);
    expect(utterances.slice(0, firstChunkCount).map(({ text }) => text).join("")).toBe(normalized);
    expect(utterances[firstChunkCount]?.text).toBe("次の通常実況も待機させます。");
    expect(fakeSpeechSynthesis.cancel).not.toHaveBeenCalled();

    utterances[firstChunkCount]?.onstart?.();
    utterances[firstChunkCount]?.onend?.();

    expect(getTTSLifecycleLog().events.map(({ kind }) => kind)).toEqual([
      "queued",
      "started",
      "ended",
      "queued",
      "started",
      "ended",
    ]);

    resetTTSLifecycleLog("long_text_test_cleanup");
    vi.unstubAllGlobals();
  });
});
