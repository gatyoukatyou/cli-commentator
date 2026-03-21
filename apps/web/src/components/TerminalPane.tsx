import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import "xterm/css/xterm.css";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { createTerminalInputGate } from "../lib/terminal-input";

const TERMINAL_OUTPUT_MAX_CHARS = 24000;

export type TerminalPaneTheme = {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
};

export type TerminalPaneHandle = {
  clear: () => void;
  focus: () => void;
  resetInputGate: () => void;
  write: (data: string) => void;
};

type TerminalPaneProps = {
  className: string;
  onData: (data: string) => void;
  onPendingOutputFlushed: () => void;
  pendingOutput: string;
  theme: TerminalPaneTheme;
};

function trimTerminalOutput(value: string): string {
  return value.length > TERMINAL_OUTPUT_MAX_CHARS ? value.slice(-TERMINAL_OUTPUT_MAX_CHARS) : value;
}

const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  { className, onData, onPendingOutputFlushed, pendingOutput, theme },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const backlogRef = useRef("");
  const terminalInputGateRef = useRef(createTerminalInputGate());

  const appendOutput = useCallback((data: string) => {
    if (!data) return;
    const terminal = terminalRef.current;
    if (!terminal) {
      backlogRef.current = trimTerminalOutput(backlogRef.current + data);
      return;
    }
    terminal.write(data);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        backlogRef.current = "";
        terminalRef.current?.clear();
      },
      focus() {
        terminalRef.current?.focus();
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

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      theme,
    });

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
    const handlePaste = () => {
      terminalInputGateRef.current.notePaste();
    };

    textarea?.addEventListener("compositionstart", handleCompositionStart);
    textarea?.addEventListener("compositionend", handleCompositionEnd);
    textarea?.addEventListener("paste", handlePaste);

    if (backlogRef.current) {
      terminal.write(backlogRef.current);
      backlogRef.current = "";
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

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
      textarea?.removeEventListener("compositionstart", handleCompositionStart);
      textarea?.removeEventListener("compositionend", handleCompositionEnd);
      textarea?.removeEventListener("paste", handlePaste);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [onData, theme]);

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
    <div
      ref={hostRef}
      className={className}
      onClick={() => terminalRef.current?.focus()}
      role="presentation"
    />
  );
});

export default TerminalPane;
