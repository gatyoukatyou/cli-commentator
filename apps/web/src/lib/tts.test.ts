import { describe, expect, it } from "vitest";
import {
  DEFAULT_TTS_SETTINGS,
  TTS_PRESETS,
  applyTTSPreset,
  detectTTSPreset,
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
    };

    const next = applyTTSPreset(current, "calm");
    expect(next.voiceURI).toBe("ja-JP-test-voice");
    expect(next.rate).toBe(0.85);
    expect(next.pitch).toBe(0.95);
    expect(next.volume).toBe(0.9);
  });

  it("detects matching preset id from settings", () => {
    const preset = TTS_PRESETS.find((candidate) => candidate.id === "clear");
    if (!preset) throw new Error("clear preset not found");
    const settings: TTSSettings = {
      voiceURI: null,
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
    };
    expect(detectTTSPreset(custom)).toBeNull();
  });
});
