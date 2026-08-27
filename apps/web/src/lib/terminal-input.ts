const RECENT_DUPLICATE_WINDOW_MS = 80;
const RECENT_PASTE_WINDOW_MS = 200;
const RECENT_COMPOSITION_WINDOW_MS = 160;
const RECENT_COMPOSITION_DUPLICATE_WINDOW_MS = 200;

type RecentChunk = {
  data: string;
  at: number;
};

export type TerminalImeKeyEvent = Pick<
  KeyboardEvent,
  "isComposing" | "key" | "keyCode" | "preventDefault"
>;

export type TerminalBeforeInputEvent = Pick<InputEvent, "data" | "inputType" | "isComposing">;

function hasNonAscii(text: string): boolean {
  for (const char of text) {
    if (char.charCodeAt(0) > 0x7f) {
      return true;
    }
  }
  return false;
}

function looksLikeCompositeChunk(data: string): boolean {
  return data.length > 1 || hasNonAscii(data);
}

function containsTerminalControl(data: string): boolean {
  return data.includes("\t") || data.includes("\r") || data.includes("\n");
}

function isCompositionControlKey(event: TerminalImeKeyEvent): boolean {
  return event.key === "Tab" || event.key === "Enter" || event.key === "Return";
}

export type TerminalInputGate = {
  noteCompositionCancel: () => void;
  noteCompositionStart: () => void;
  noteCompositionEnd: () => void;
  notePaste: () => void;
  reset: () => void;
  shouldSuppressBeforeInput: (event: TerminalBeforeInputEvent) => boolean;
  shouldSuppressKeyEvent: (event: TerminalImeKeyEvent) => boolean;
  shouldForward: (data: string) => boolean;
};

export function createTerminalInputGate(now: () => number = () => Date.now()): TerminalInputGate {
  let composing = false;
  let lastCompositionEndAt = 0;
  let lastPasteAt = 0;
  let lastForwarded: RecentChunk | null = null;

  return {
    noteCompositionCancel() {
      composing = false;
      lastCompositionEndAt = 0;
    },

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

    shouldSuppressKeyEvent(event) {
      const imeActive = composing || event.isComposing;
      return event.keyCode === 229 || (imeActive && isCompositionControlKey(event));
    },

    shouldSuppressBeforeInput(event) {
      if (!containsTerminalControl(event.data ?? "")) return false;
      return composing || event.isComposing || event.inputType.startsWith("insertComposition");
    },

    shouldForward(data: string) {
      if (!data) return false;

      const ts = now();
      if (composing) {
        // Composition text is emitted by xterm after compositionend. Keeping the
        // gate closed until then prevents intermediate IME text from reaching the PTY.
        return false;
      }

      const nearComposition = ts - lastCompositionEndAt <= RECENT_COMPOSITION_WINDOW_MS;
      const nearPaste = ts - lastPasteAt <= RECENT_PASTE_WINDOW_MS;
      const duplicate =
        lastForwarded !== null &&
        lastForwarded.data === data &&
        ts - lastForwarded.at <=
          (nearComposition ? RECENT_COMPOSITION_DUPLICATE_WINDOW_MS : RECENT_DUPLICATE_WINDOW_MS);

      if (duplicate && (nearComposition || nearPaste || looksLikeCompositeChunk(data))) {
        return false;
      }

      lastForwarded = { data, at: ts };
      return true;
    },
  };
}
