const RECENT_DUPLICATE_WINDOW_MS = 80;
const RECENT_PASTE_WINDOW_MS = 200;
const RECENT_COMPOSITION_WINDOW_MS = 160;

type RecentChunk = {
  data: string;
  at: number;
};

function hasNonAscii(text: string): boolean {
  return /[^\u0000-\u007f]/u.test(text);
}

function looksLikeCompositeChunk(data: string): boolean {
  return data.length > 1 || hasNonAscii(data);
}

export type TerminalInputGate = {
  noteCompositionStart: () => void;
  noteCompositionEnd: () => void;
  notePaste: () => void;
  reset: () => void;
  shouldForward: (data: string) => boolean;
};

export function createTerminalInputGate(now: () => number = () => Date.now()): TerminalInputGate {
  let composing = false;
  let lastCompositionEndAt = 0;
  let lastPasteAt = 0;
  let lastForwarded: RecentChunk | null = null;

  return {
    noteCompositionStart() {
      composing = true;
    },

    noteCompositionEnd() {
      composing = false;
      lastCompositionEndAt = now();
    },

    notePaste() {
      lastPasteAt = now();
    },

    reset() {
      composing = false;
      lastCompositionEndAt = 0;
      lastPasteAt = 0;
      lastForwarded = null;
    },

    shouldForward(data: string) {
      if (!data) return false;

      const ts = now();
      if (composing) {
        return false;
      }

      const nearComposition = ts - lastCompositionEndAt <= RECENT_COMPOSITION_WINDOW_MS;
      const nearPaste = ts - lastPasteAt <= RECENT_PASTE_WINDOW_MS;
      const duplicate =
        lastForwarded !== null &&
        lastForwarded.data === data &&
        ts - lastForwarded.at <= RECENT_DUPLICATE_WINDOW_MS;

      if (duplicate && (nearComposition || nearPaste || looksLikeCompositeChunk(data))) {
        return false;
      }

      lastForwarded = { data, at: ts };
      return true;
    },
  };
}
