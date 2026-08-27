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
  "isComposing" | "key" | "keyCode"
> & {
  type?: KeyboardEvent["type"];
};

export type TerminalBeforeInputEvent = Pick<InputEvent, "data" | "inputType" | "isComposing">;

export type TerminalKeyHandling = "normal" | "ime";

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
  handleKeyEvent: (event: TerminalImeKeyEvent) => TerminalKeyHandling;
  noteCompositionCancel: () => void;
  noteCompositionStart: () => void;
  noteCompositionEnd: () => void;
  notePaste: () => void;
  reset: () => void;
  shouldSuppressBeforeInput: (event: TerminalBeforeInputEvent) => boolean;
  shouldForward: (data: string) => boolean;
};

export function createTerminalInputGate(now: () => number = () => Date.now()): TerminalInputGate {
  let composing = false;
  let compositionControlPending = false;
  let compositionControlSeen = false;
  let compositionCommitForwarded = false;
  let compositionControlAt = 0;
  let lastCompositionEndAt = 0;
  let lastPasteAt = 0;
  let lastForwarded: RecentChunk | null = null;

  return {
    handleKeyEvent(event) {
      const imeActive = composing || event.isComposing;
      if (imeActive && isCompositionControlKey(event)) {
        if (event.type === undefined || event.type === "keydown") {
          // Let xterm's CompositionHelper see Enter/Tab so it can finalize the
          // composition. shouldForward() removes the control byte afterward.
          compositionControlPending = true;
          compositionControlAt = now();
        }
        // Do not let the ordinary Tab handler run for any event in this IME
        // control-key sequence (including keypress/keyup).
        return "ime";
      }

      // keyCode 229 is xterm's IME marker. xterm must handle it itself; it
      // does not represent a byte that should be sent to the PTY.
      if (event.keyCode === 229) return "ime";
      return "normal";
    },

    noteCompositionCancel() {
      composing = false;
      compositionControlPending = false;
      compositionControlSeen = false;
      compositionCommitForwarded = false;
      compositionControlAt = 0;
      lastCompositionEndAt = 0;
    },

    noteCompositionStart() {
      composing = true;
      compositionControlPending = false;
      compositionControlSeen = false;
      compositionCommitForwarded = false;
      compositionControlAt = 0;
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
      compositionControlPending = false;
      compositionControlSeen = false;
      compositionCommitForwarded = false;
      compositionControlAt = 0;
      lastCompositionEndAt = 0;
      lastPasteAt = 0;
      lastForwarded = null;
    },

    shouldSuppressBeforeInput(event) {
      if (!containsTerminalControl(event.data ?? "")) return false;
      return composing || event.isComposing || event.inputType.startsWith("insertComposition");
    },

    shouldForward(data: string) {
      if (!data) return false;

      const ts = now();

      if (compositionControlPending && ts - compositionControlAt > RECENT_COMPOSITION_DUPLICATE_WINDOW_MS) {
        compositionControlPending = false;
        compositionControlSeen = false;
        compositionCommitForwarded = false;
        compositionControlAt = 0;
      }

      if (compositionControlPending) {
        if (data === "\t" || data === "\r" || data === "\n") {
          // xterm emits the composition text first and the control key next
          // when Enter/Tab finalizes an active composition.
          compositionControlSeen = true;
          if (compositionCommitForwarded) {
            compositionControlPending = false;
            compositionControlSeen = false;
            compositionControlAt = 0;
          }
          return false;
        }

        // A composition-control key reached xterm's CompositionHelper. The
        // first non-control chunk is its committed composition text.
        if (!compositionCommitForwarded) {
          compositionCommitForwarded = true;
        }
        if (composing) {
          composing = false;
          lastCompositionEndAt = ts;
        }
        if (compositionControlSeen) {
          compositionControlPending = false;
          compositionControlSeen = false;
          compositionControlAt = 0;
        }
      }

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
