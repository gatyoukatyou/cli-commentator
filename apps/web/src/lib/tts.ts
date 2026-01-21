/**
 * TTS (Text-to-Speech) utilities using Web Speech API
 * Sprint 24: cancel方式（最新のみ読み上げ）
 */

/** TTS サポート判定 */
export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * テキスト正規化（ログ記号除去、長さ制限）
 */
export function normalizeForSpeech(text: string, maxLength = 500): string {
  const cleaned = text
    .replace(/\x1b\[[0-9;]*m/g, "") // ANSI escape codes
    .replace(/[─│┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬═║]+/g, "") // Box drawing characters
    .replace(/[⏺⎿✅✓✔✗✘➜➤●○◉◎■□▪▫►▶◀◁★☆❯❮⚡⚠️🔴🟢🟡⬛⬜]+/gu, "") // CLI decorative symbols
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
 */
export function speak(text: string, lang = "ja-JP"): void {
  if (!isTTSSupported()) return;

  speechSynthesis.cancel(); // 前の発話をキャンセル

  const normalized = normalizeForSpeech(text);
  if (!normalized) return;

  const utterance = new SpeechSynthesisUtterance(normalized);
  utterance.lang = lang;
  utterance.rate = 1.0;

  speechSynthesis.speak(utterance);
}

// localStorage キー
const TTS_ENABLED_KEY = "cli-commentator-tts-enabled";

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
