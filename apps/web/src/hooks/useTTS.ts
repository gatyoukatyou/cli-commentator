import { useCallback, useEffect, useRef, useState } from "react";
import { buildSpeechText, getCommentaryTextParts } from "../lib/glossary-note";
import { getCommentaryGroupKey, type CommentaryItem } from "../lib/log-filter";
import {
  applyTTSPreset,
  downloadTTSLifecycleLog,
  getTTSEnabled,
  getTTSSettings,
  isTTSSupported,
  resetTTSLifecycleLog,
  setTTSEnabled,
  setTTSSettings,
  speak,
  speakWithPriority,
  stopSpeech,
  waitForVoices,
  type TTSPresetId,
  type TTSSettings,
} from "../lib/tts";
import type { CommentaryDisplayMode } from "../types";
import { normalizeSuggestion } from "../lib/text";

const TTS_BATCH_DELAY_MS = 320;
const TTS_PRIORITY_BATCH_DELAY_MS = 120;

type PendingSpeechBatch = {
  groupKey: string | null;
  latest: CommentaryItem;
  count: number;
};

type UseTTSOptions = {
  commentaryDisplayMode: CommentaryDisplayMode;
};

export function useTTS({ commentaryDisplayMode }: UseTTSOptions) {
  const [ttsEnabled, setTtsEnabledState] = useState(() => getTTSEnabled());
  const [ttsSettings, setTtsSettingsState] = useState<TTSSettings>(() => getTTSSettings());
  const [ttsSettingsOpen, setTtsSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const ttsSupported = isTTSSupported();
  const ttsEnabledRef = useRef(ttsEnabled);
  const ttsSettingsRef = useRef(ttsSettings);
  const pendingSpeechRef = useRef<PendingSpeechBatch | null>(null);
  const pendingSpeechTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  useEffect(() => {
    ttsSettingsRef.current = ttsSettings;
  }, [ttsSettings]);

  useEffect(() => {
    if (!ttsSupported) return;
    waitForVoices().then((availableVoices) => {
      setVoices(availableVoices);
      setVoicesLoaded(true);
    });
  }, [ttsSupported]);

  useEffect(() => {
    return () => {
      if (pendingSpeechTimeoutRef.current) {
        clearTimeout(pendingSpeechTimeoutRef.current);
        pendingSpeechTimeoutRef.current = null;
      }
      pendingSpeechRef.current = null;
      stopSpeech();
    };
  }, []);

  const clearPendingSpeech = useCallback(() => {
    if (pendingSpeechTimeoutRef.current) {
      clearTimeout(pendingSpeechTimeoutRef.current);
      pendingSpeechTimeoutRef.current = null;
    }
    pendingSpeechRef.current = null;
  }, []);

  const stopAndClearSpeech = useCallback(() => {
    clearPendingSpeech();
    stopSpeech();
  }, [clearPendingSpeech]);

  const flushPendingSpeech = useCallback(() => {
    if (pendingSpeechTimeoutRef.current) {
      clearTimeout(pendingSpeechTimeoutRef.current);
      pendingSpeechTimeoutRef.current = null;
    }

    const pending = pendingSpeechRef.current;
    pendingSpeechRef.current = null;
    if (!pending || !ttsEnabledRef.current) return;

    const rawDetail = !pending.latest.speech && ttsSettingsRef.current.includeRawDetail
      ? normalizeSuggestion(pending.latest.detail)
      : undefined;
    const speechText = buildSpeechText(
      getCommentaryTextParts({
        narration: pending.latest.narration,
        explanation: pending.latest.explanation,
        glossaryNotes: pending.latest.glossaryNotes,
      }),
      pending.count,
      rawDetail,
      commentaryDisplayMode,
      pending.latest.speech
    );
    if (!speechText) return;
    // notice（完了/沈黙）は進行中の発話を止めずキュー末尾、progressは従来のcancel方式
    speakWithPriority(speechText, pending.latest.priority ?? "progress", ttsSettingsRef.current);
  }, [commentaryDisplayMode]);

  const schedulePendingSpeech = useCallback(() => {
    if (pendingSpeechTimeoutRef.current) {
      clearTimeout(pendingSpeechTimeoutRef.current);
    }
    const pending = pendingSpeechRef.current;
    const delay =
      pending && (pending.latest.eventType === "error" || pending.latest.eventType === "done")
        ? TTS_PRIORITY_BATCH_DELAY_MS
        : TTS_BATCH_DELAY_MS;
    pendingSpeechTimeoutRef.current = setTimeout(() => {
      flushPendingSpeech();
    }, delay);
  }, [flushPendingSpeech]);

  const queueSpeech = useCallback(
    (item: CommentaryItem) => {
      if (!ttsEnabledRef.current) return;
      if (item.speech?.disposition === "display_only") return;

      const groupKey = getCommentaryGroupKey(item);
      const pending = pendingSpeechRef.current;
      if (pending && groupKey && pending.groupKey === groupKey) {
        pending.latest = item;
        pending.count += 1;
        schedulePendingSpeech();
        return;
      }

      if (pending) {
        flushPendingSpeech();
      }

      pendingSpeechRef.current = {
        groupKey,
        latest: item,
        count: 1,
      };
      schedulePendingSpeech();
    },
    [flushPendingSpeech, schedulePendingSpeech]
  );

  /**
   * urgentイベントの即時読み上げ（進行中の発話に割り込む）
   * @returns 実際に読み上げた場合 true（TTS無効時は false）
   */
  const speakUrgentNow = useCallback((text: string): boolean => {
    if (!ttsEnabledRef.current) return false;
    return speakWithPriority(text, "urgent", ttsSettingsRef.current);
  }, []);

  const handleTTSToggle = useCallback(
    (enabled: boolean) => {
      setTtsEnabledState(enabled);
      setTTSEnabled(enabled);
      if (enabled) {
        resetTTSLifecycleLog("tts_enabled");
        speak("読み上げを開始します", ttsSettings);
      } else {
        stopAndClearSpeech();
        setTtsSettingsOpen(false);
      }
    },
    [stopAndClearSpeech, ttsSettings]
  );

  const handleTTSSettingsChange = useCallback((newSettings: TTSSettings) => {
    setTtsSettingsState(newSettings);
    setTTSSettings(newSettings);
  }, []);

  const handleTTSPresetChange = useCallback(
    (presetId: TTSPresetId | "custom") => {
      if (presetId === "custom") return;
      handleTTSSettingsChange(applyTTSPreset(ttsSettings, presetId));
    },
    [handleTTSSettingsChange, ttsSettings]
  );

  const handleTestSpeak = useCallback(() => {
    speak("これはテスト読み上げです。設定を確認してください。", ttsSettings);
  }, [ttsSettings]);

  const handleExportTTSLog = useCallback(() => {
    downloadTTSLifecycleLog(ttsSettingsRef.current);
  }, []);

  const handleResetTTSLog = useCallback(() => {
    resetTTSLifecycleLog("manual_reset");
  }, []);

  const resetTTSLifecycleSession = useCallback((trigger: string) => {
    resetTTSLifecycleLog(trigger);
  }, []);

  return {
    ttsEnabled,
    ttsSettings,
    ttsSettingsOpen,
    setTtsSettingsOpen,
    voices,
    voicesLoaded,
    ttsSupported,
    clearPendingSpeech,
    stopAndClearSpeech,
    queueSpeech,
    speakUrgentNow,
    handleTTSToggle,
    handleTTSSettingsChange,
    handleTTSPresetChange,
    handleTestSpeak,
    handleExportTTSLog,
    handleResetTTSLog,
    resetTTSLifecycleSession,
  };
}
