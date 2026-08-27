/** @vitest-environment jsdom */

import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalPaneHandle, TerminalPaneTheme } from "./TerminalPane";
import TerminalPane from "./TerminalPane";
import { CLI_TERMINAL_THEME, STANDARD_TERMINAL_THEME } from "../lib/terminal-theme";

type FakeTerminalInstance = {
  cols: number;
  rows: number;
  disposed: boolean;
  options: { minimumContrastRatio: number; theme: TerminalPaneTheme };
  textarea: HTMLTextAreaElement;
  written: string;
  emitData: (data: string) => void;
  runCustomKeyEvent: (event: KeyboardEvent) => boolean;
};

const xtermState = vi.hoisted(() => ({
  instances: [] as FakeTerminalInstance[],
}));

vi.mock("xterm", () => {
  class FakeTerminal {
    cols = 100;
    rows = 30;
    buffer = { active: { baseY: 0, viewportY: 0 } };
    disposed = false;
    options: { minimumContrastRatio: number; theme: TerminalPaneTheme };
    textarea = document.createElement("textarea");
    written = "";
    private dataHandler: ((data: string) => void) | null = null;
    private customKeyEventHandler: ((event: KeyboardEvent) => boolean) | null = null;

    constructor(options: { minimumContrastRatio: number; theme: TerminalPaneTheme }) {
      this.options = {
        minimumContrastRatio: options.minimumContrastRatio,
        theme: options.theme,
      };
      xtermState.instances.push(this);
    }

    loadAddon(): void {}

    open(host: HTMLElement): void {
      host.append(this.textarea);
    }

    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
      this.customKeyEventHandler = handler;
    }

    onScroll(): { dispose: () => void } {
      return { dispose: () => {} };
    }

    onResize(): { dispose: () => void } {
      return { dispose: () => {} };
    }

    onData(handler: (data: string) => void): void {
      this.dataHandler = handler;
    }

    emitData(data: string): void {
      this.dataHandler?.(data);
    }

    runCustomKeyEvent(event: KeyboardEvent): boolean {
      return this.customKeyEventHandler?.(event) ?? true;
    }

    write(data: string, callback?: () => void): void {
      this.written += data;
      callback?.();
    }

    clear(): void {
      this.written = "";
    }

    focus(): void {}
    refresh(): void {}
    scrollToBottom(): void {}

    dispose(): void {
      this.disposed = true;
    }
  }

  return { Terminal: FakeTerminal };
});

vi.mock("xterm-addon-fit", () => {
  class FakeFitAddon {
    fit(): void {}
  }

  return { FitAddon: FakeFitAddon };
});

describe("TerminalPane", () => {
  beforeEach(() => {
    xtermState.instances.length = 0;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("keeps the xterm instance, history, and size when the theme changes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const terminalRef = createRef<TerminalPaneHandle>();
    const callbacks = {
      onData: vi.fn(),
      onFocusChange: vi.fn(),
      onResize: vi.fn(),
      onPendingOutputFlushed: vi.fn(),
    };

    const render = async (theme: TerminalPaneTheme) => {
      await act(async () => {
        root.render(
          <TerminalPane
            ref={terminalRef}
            className="terminal"
            onData={callbacks.onData}
            onFocusChange={callbacks.onFocusChange}
            onResize={callbacks.onResize}
            onPendingOutputFlushed={callbacks.onPendingOutputFlushed}
            pendingOutput=""
            theme={theme}
          />
        );
      });
    };

    await render(CLI_TERMINAL_THEME);
    const [terminal] = xtermState.instances;
    terminalRef.current?.write("history-before-skin-change\n");

    await render(STANDARD_TERMINAL_THEME);

    expect(xtermState.instances).toHaveLength(1);
    expect(terminal.disposed).toBe(false);
    expect(terminal.written).toContain("history-before-skin-change");
    expect(terminal.options.theme).toEqual(STANDARD_TERMINAL_THEME);
    expect(terminal.options.minimumContrastRatio).toBe(4.5);
    expect(terminal.cols).toBe(100);
    expect(terminal.rows).toBe(30);

    await act(async () => {
      root.unmount();
    });
    expect(terminal.disposed).toBe(true);
  });

  it("forwards committed Japanese once, blocks IME controls, and preserves physical Tab", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const callbacks = {
      onData: vi.fn(),
      onFocusChange: vi.fn(),
      onResize: vi.fn(),
      onPendingOutputFlushed: vi.fn(),
    };

    await act(async () => {
      root.render(
        <TerminalPane
          className="terminal"
          onData={callbacks.onData}
          onFocusChange={callbacks.onFocusChange}
          onResize={callbacks.onResize}
          onPendingOutputFlushed={callbacks.onPendingOutputFlushed}
          pendingOutput=""
          theme={CLI_TERMINAL_THEME}
        />
      );
    });

    const [terminal] = xtermState.instances;
    const imeTab = {
      altKey: false,
      ctrlKey: false,
      isComposing: true,
      key: "Tab",
      keyCode: 9,
      metaKey: false,
      preventDefault: vi.fn(),
      shiftKey: false,
    } as unknown as KeyboardEvent;

    await act(async () => {
      terminal.textarea.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    });
    expect(terminal.runCustomKeyEvent(imeTab)).toBe(false);
    expect(imeTab.preventDefault).toHaveBeenCalledOnce();
    terminal.emitData("\t");

    await act(async () => {
      terminal.textarea.dispatchEvent(new Event("compositionend", { bubbles: true }));
    });
    terminal.emitData("日本語入力テスト");
    terminal.emitData("日本語入力テスト");

    expect(callbacks.onData).toHaveBeenCalledTimes(1);
    expect(callbacks.onData).toHaveBeenCalledWith("日本語入力テスト");

    const physicalTab = {
      altKey: false,
      ctrlKey: false,
      isComposing: false,
      key: "Tab",
      keyCode: 9,
      metaKey: false,
      preventDefault: vi.fn(),
      shiftKey: false,
    } as unknown as KeyboardEvent;
    expect(terminal.runCustomKeyEvent(physicalTab)).toBe(true);
    terminal.emitData("\t");
    expect(callbacks.onData).toHaveBeenCalledWith("\t");

    await act(async () => {
      root.unmount();
    });
  });
});
