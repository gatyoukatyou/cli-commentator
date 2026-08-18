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
  options: { theme: TerminalPaneTheme };
  textarea: HTMLTextAreaElement;
  written: string;
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
    options: { theme: TerminalPaneTheme };
    textarea = document.createElement("textarea");
    written = "";

    constructor(options: { theme: TerminalPaneTheme }) {
      this.options = { theme: options.theme };
      xtermState.instances.push(this);
    }

    loadAddon(): void {}

    open(host: HTMLElement): void {
      host.append(this.textarea);
    }

    attachCustomKeyEventHandler(): void {}

    onScroll(): { dispose: () => void } {
      return { dispose: () => {} };
    }

    onResize(): { dispose: () => void } {
      return { dispose: () => {} };
    }

    onData(): void {}

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
    expect(terminal.cols).toBe(100);
    expect(terminal.rows).toBe(30);

    await act(async () => {
      root.unmount();
    });
    expect(terminal.disposed).toBe(true);
  });
});
