import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "xterm/css/xterm.css";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { createTerminalInputGate } from "../lib/terminal-input";
import { handleTerminalLatestKey, jumpTerminalToLatest } from "../lib/terminal-keyboard";
import { isAtTerminalLatest } from "../lib/terminal-scroll";
import { terminalBufferToText } from "../lib/terminal-text";
import type { TerminalTheme } from "../lib/terminal-theme";
import type { PtySize } from "../types";

const TERMINAL_OUTPUT_MAX_CHARS = 24000;

export type TerminalPaneTheme = TerminalTheme;

export type TerminalPaneHandle = {
  clear: () => void;
  focus: () => void;
  getText: () => string;
  resetInputGate: () => void;
  write: (data: string) => void;
};

type TerminalPaneProps = {
  className: string;
  onData: (data: string) => void;
  onFocusChange: (focused: boolean) => void;
  onResize: (size: PtySize) => void;
  onPendingOutputFlushed: () => void;
  pendingOutput: string;
  theme: TerminalPaneTheme;
};

function trimTerminalOutput(value: string): string {
  return value.length > TERMINAL_OUTPUT_MAX_CHARS ? value.slice(-TERMINAL_OUTPUT_MAX_CHARS) : value;
}

const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  { className, onData, onFocusChange, onResize, onPendingOutputFlushed, pendingOutput, theme },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initialThemeRef = useRef(theme);
  const backlogRef = useRef("");
  const terminalInputGateRef = useRef(createTerminalInputGate());
  const shouldAutoFollowRef = useRef(true);
  const isAtLatestRef = useRef(true);
  const latestButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isAtLatest, setIsAtLatest] = useState(true);

  const updateScrollState = useCallback((viewportY: number) => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const atLatest = isAtTerminalLatest({
      viewportY,
      baseY: terminal.buffer.active.baseY,
    });
    shouldAutoFollowRef.current = atLatest;
    isAtLatestRef.current = atLatest;
    setIsAtLatest(atLatest);
  }, []);

  const appendOutput = useCallback((data: string) => {
    if (!data) return;
    const terminal = terminalRef.current;
    if (!terminal) {
      backlogRef.current = trimTerminalOutput(backlogRef.current + data);
      return;
    }
    const shouldFollow = shouldAutoFollowRef.current;
    terminal.write(data, () => {
      if (shouldFollow && shouldAutoFollowRef.current) {
        terminal.scrollToBottom();
      }
      updateScrollState(terminal.buffer.active.viewportY);
    });
  }, [updateScrollState]);

  const handleJumpToLatest = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    jumpTerminalToLatest(terminal, () => {
      shouldAutoFollowRef.current = true;
      isAtLatestRef.current = true;
      setIsAtLatest(true);
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        backlogRef.current = "";
        terminalRef.current?.clear();
        shouldAutoFollowRef.current = true;
        isAtLatestRef.current = true;
        setIsAtLatest(true);
      },
      focus() {
        terminalRef.current?.focus();
      },
      getText() {
        const terminal = terminalRef.current;
        if (!terminal) return backlogRef.current;

        const selectedText = terminal.getSelection();
        if (selectedText) return selectedText;

        const activeText = terminalBufferToText(terminal.buffer.active);
        if (terminal.buffer.active.type !== "alternate") return activeText;

        const normalText = terminalBufferToText(terminal.buffer.normal);
        return [normalText, activeText].filter(Boolean).join("\n\n");
      },
      resetInputGate() {
        terminalInputGateRef.current.reset();
      },
      write(data: string) {
        appendOutput(data);
      },
    }),
    [appendOutput]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || terminalRef.current) return;

    let disposed = false;
    let frameId: number | null = null;
    let lastReportedSize = "";

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      lineHeight: 1.35,
      // Keep dark ANSI foregrounds emitted by nested TUIs readable on our dark surface.
      minimumContrastRatio: 4.5,
      scrollback: 5000,
      theme: initialThemeRef.current,
    });

    const reportSize = (cols: number, rows: number) => {
      const sizeKey = `${cols}x${rows}`;
      if (lastReportedSize === sizeKey) return;
      lastReportedSize = sizeKey;
      onResize({ cols, rows });
    };

    const scheduleFit = () => {
      if (disposed) return;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        if (disposed) return;
        try {
          fitAddon.fit();
          reportSize(terminal.cols, terminal.rows);
          terminal.refresh(0, Math.max(0, terminal.rows - 1));
          terminal.focus();
        } catch (error) {
          if (import.meta.env.DEV) {
            console.debug("xterm fit skipped", error);
          }
        }
      });
    };

    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    terminal.attachCustomKeyEventHandler((event) => {
      const inputGate = terminalInputGateRef.current;
      if (inputGate.handleKeyEvent(event) === "ime") return true;

      return handleTerminalLatestKey(event, {
        getLatestButton: () => latestButtonRef.current,
        isAtLatest: () => isAtLatestRef.current,
      });
    });

    const viewport = host.querySelector<HTMLElement>(".xterm-viewport");
    const handleViewportScroll = () => {
      updateScrollState(terminal.buffer.active.viewportY);
    };
    viewport?.addEventListener("scroll", handleViewportScroll);
    const scrollDisposable = terminal.onScroll((viewportY) => {
      updateScrollState(viewportY);
    });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      reportSize(cols, rows);
    });
    scheduleFit();

    terminal.onData((data) => {
      if (!terminalInputGateRef.current.shouldForward(data)) return;
      onData(data);
    });

    const textarea = terminal.textarea;
    const handleCompositionStart = () => {
      terminalInputGateRef.current.noteCompositionStart();
    };
    const handleCompositionEnd = () => {
      terminalInputGateRef.current.noteCompositionEnd();
    };
    const handleCompositionCancel = () => {
      terminalInputGateRef.current.noteCompositionCancel();
    };
    const handleBeforeInput = (event: InputEvent) => {
      if (terminalInputGateRef.current.shouldSuppressBeforeInput(event)) {
        event.preventDefault();
      }
    };
    const handlePaste = () => {
      terminalInputGateRef.current.notePaste();
    };
    const handleFocus = () => onFocusChange(true);
    const handleBlur = () => onFocusChange(false);

    // Capture compositionend before xterm's handler so its delayed/synchronous
    // committed text is accepted by the gate exactly once.
    textarea?.addEventListener("compositionstart", handleCompositionStart, true);
    textarea?.addEventListener("compositionend", handleCompositionEnd, true);
    textarea?.addEventListener("compositioncancel", handleCompositionCancel, true);
    textarea?.addEventListener("beforeinput", handleBeforeInput, true);
    textarea?.addEventListener("paste", handlePaste);
    textarea?.addEventListener("focus", handleFocus);
    textarea?.addEventListener("blur", handleBlur);

    if (backlogRef.current) {
      appendOutput(backlogRef.current);
      backlogRef.current = "";
    }

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            scheduleFit();
          })
        : null;
    resizeObserver?.observe(host);

    return () => {
      disposed = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      viewport?.removeEventListener("scroll", handleViewportScroll);
      scrollDisposable.dispose();
      resizeDisposable.dispose();
      textarea?.removeEventListener("compositionstart", handleCompositionStart, true);
      textarea?.removeEventListener("compositionend", handleCompositionEnd, true);
      textarea?.removeEventListener("compositioncancel", handleCompositionCancel, true);
      textarea?.removeEventListener("beforeinput", handleBeforeInput, true);
      textarea?.removeEventListener("paste", handlePaste);
      textarea?.removeEventListener("focus", handleFocus);
      textarea?.removeEventListener("blur", handleBlur);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [appendOutput, onData, onFocusChange, onResize, updateScrollState]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = theme;
    fitAddonRef.current?.fit();
  }, [theme]);

  useEffect(() => {
    if (!pendingOutput) return;
    appendOutput(pendingOutput);
    onPendingOutputFlushed();
  }, [appendOutput, onPendingOutputFlushed, pendingOutput]);

  return (
    <div className={`terminal-pane${isAtLatest ? "" : " terminal-pane--show-latest"}`}>
      <div
        ref={hostRef}
        className={className}
        style={{ "--terminal-background": theme.background } as CSSProperties}
        onMouseDown={() => terminalRef.current?.focus()}
        aria-label="Managed Terminal の入力欄"
        role="group"
      />
      {!isAtLatest && (
        <button
          ref={latestButtonRef}
          type="button"
          className="terminal-pane__latest"
          onClick={handleJumpToLatest}
          aria-label="Managed Terminalを最新位置へ戻る"
        >
          ↓ 最新へ
        </button>
      )}
    </div>
  );
});

export default TerminalPane;
