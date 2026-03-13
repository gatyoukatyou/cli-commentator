import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TTS_SETTINGS,
  TTS_PRESETS,
  applyTTSPreset,
  detectTTSPreset,
  resetTTSForTests,
  speak,
  type TTSSettings,
} from "./tts";

class MockSpeechSynthesisUtterance {
  text: string;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: { voiceURI: string } | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

type MockSpeechSynthesis = {
  cancel: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
  onvoiceschanged: ((this: SpeechSynthesis, ev: Event) => unknown) | null;
  speak: ReturnType<typeof vi.fn>;
};

const originalWindow = globalThis.window;
const originalSpeechSynthesis = globalThis.speechSynthesis;
const originalUtterance = globalThis.SpeechSynthesisUtterance;

let speechSynthesisMock: MockSpeechSynthesis;
let spokenUtterances: MockSpeechSynthesisUtterance[];

beforeEach(() => {
  spokenUtterances = [];
  speechSynthesisMock = {
    cancel: vi.fn(() => {
      const active = spokenUtterances.at(-1);
      active?.onerror?.();
    }),
    getVoices: vi.fn(() => [{ voiceURI: "ja-JP-test-voice" }]),
    onvoiceschanged: null,
    speak: vi.fn((utterance: MockSpeechSynthesisUtterance) => {
      spokenUtterances.push(utterance);
    }),
  };

  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("speechSynthesis", speechSynthesisMock);
  vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);
  resetTTSForTests();
});

afterEach(() => {
  resetTTSForTests();
  vi.unstubAllGlobals();
  if (originalWindow) {
    vi.stubGlobal("window", originalWindow);
  }
  if (originalSpeechSynthesis) {
    vi.stubGlobal("speechSynthesis", originalSpeechSynthesis);
  }
  if (originalUtterance) {
    vi.stubGlobal("SpeechSynthesisUtterance", originalUtterance);
  }
});

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
      engine: "browser",
      voiceURI: "ja-JP-test-voice",
      rate: 1.2,
      pitch: 1.2,
      volume: 0.8,
      voicevoxBaseUrl: "http://127.0.0.1:50021",
      voicevoxSpeaker: 1,
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
      engine: "browser",
      voiceURI: null,
      voicevoxBaseUrl: "http://127.0.0.1:50021",
      voicevoxSpeaker: 1,
      includeRawDetail: false,
      ...preset.settings,
    };
    expect(detectTTSPreset(settings)).toBe("clear");
  });

  it("returns null for custom settings", () => {
    const custom: TTSSettings = {
      engine: "browser",
      voiceURI: null,
      rate: 0.92,
      pitch: 1.03,
      volume: 0.97,
      voicevoxBaseUrl: "http://127.0.0.1:50021",
      voicevoxSpeaker: 1,
      includeRawDetail: false,
    };
    expect(detectTTSPreset(custom)).toBeNull();
  });

  it("queues browser speech instead of interrupting the current utterance", async () => {
    speechSynthesisMock.cancel.mockClear();
    speak("first");
    speak("second");

    expect(speechSynthesisMock.speak).toHaveBeenCalledTimes(1);
    expect(spokenUtterances[0]?.text).toBe("first");

    spokenUtterances[0]?.onend?.();
    await Promise.resolve();

    expect(speechSynthesisMock.speak).toHaveBeenCalledTimes(2);
    expect(spokenUtterances[1]?.text).toBe("second");
    expect(speechSynthesisMock.cancel).not.toHaveBeenCalled();
  });
});
