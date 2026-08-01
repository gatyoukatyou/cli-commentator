import { describe, expect, it } from "vitest";
import { classifyFailure } from "@cli-commentator/shared/failure-classification";
import { buildUrgentSpeechText } from "@cli-commentator/shared/urgent-speech";
import { beginnerOneLine } from "./beginner-lines.js";
import type { Event } from "../types.js";

const SAMPLES = [
  ["TS2554: Expected 1 arguments, but got 2.", "type-error"],
  ["listen EADDRINUSE: address already in use :::8787", "port-in-use"],
  ["EACCES: permission denied, open '/etc/hosts'", "permission"],
  ["Error: Cannot find module 'zod'", "module-not-found"],
  ["zsh: command not found: pnpm", "command-not-found"],
  ["ELIFECYCLE  Command failed with exit code 1.", "exit-code"],
] as const;

describe("classifyFailure", () => {
  it.each(SAMPLES)("recognises %s", (detail, kind) => {
    expect(classifyFailure(detail)).toBe(kind);
  });

  it("returns null when the log says nothing recognisable", () => {
    expect(classifyFailure("something went wrong")).toBeNull();
    expect(classifyFailure(undefined)).toBeNull();
  });

  // The port message also contains "listen", and an exit-code line often
  // accompanies a more specific cause; the specific pattern has to win.
  it("prefers the specific cause over a trailing exit code", () => {
    expect(
      classifyFailure("Error: listen EADDRINUSE: address already in use\nELIFECYCLE exit code 1")
    ).toBe("port-in-use");
  });
});

describe("urgent speech for failures", () => {
  function failure(detail: string): Event {
    // Every ruleset collapses failures to this summary, which is why the spoken
    // line used to be "要対応です：エラーが出ている。" no matter what broke.
    return { ts: 1, type: "error", summary: "エラーが出ている", detail };
  }

  it.each([
    ["listen EADDRINUSE: address already in use :::8787", "要対応です：使用中のポートで起動できません。"],
    ["zsh: command not found: pnpm", "要対応です：コマンドが見つかりません。"],
    ["Error: Cannot find module 'zod'", "要対応です：参照先の部品が見つかりません。"],
    ["EACCES: permission denied", "要対応です：権限が足りず実行できません。"],
    ["TS2554: Expected 1 arguments", "要対応です：型の不一致が出ています。"],
    ["ELIFECYCLE  Command failed with exit code 1.", "要対応です：コマンドが失敗して終了しました。"],
  ])("names what failed: %s", (detail, expected) => {
    expect(buildUrgentSpeechText(failure(detail))).toBe(expected);
  });

  it("keeps the summary when the log identifies no known failure", () => {
    expect(buildUrgentSpeechText(failure("something went wrong"))).toBe(
      "要対応です：エラーが出ている。"
    );
  });

  // Approval and question prompts are more urgent than any failure text that
  // happens to be scrolled into the same excerpt.
  it("still prioritises an approval prompt", () => {
    const event: Event = {
      ts: 1,
      type: "error",
      summary: "コマンド実行の確認待ち",
      detail: "would you like to run the following command?\n  pnpm test\nexit code 1",
    };
    expect(buildUrgentSpeechText(event)).toBe("要対応です：「テスト」の実行許可を求めています。");
  });
});

describe("failure wording stays split between speech and display", () => {
  it.each(SAMPLES)("explains %s at more length than it speaks it", (detail) => {
    const event: Event = { ts: 1, type: "error", summary: "エラーが出ている", detail };
    const spoken = buildUrgentSpeechText(event);
    const displayed = beginnerOneLine(event);
    expect(displayed.length).toBeGreaterThan(spoken.length);
  });
});
