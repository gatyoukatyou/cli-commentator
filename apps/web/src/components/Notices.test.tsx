import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Event } from "../types";
import { toAttentionNotice } from "../lib/event-notify";
import { Notices } from "./Notices";

const baseProps = {
  onDismissAttention: () => undefined,
  onFocusTerminal: () => undefined,
  ptyUnavailable: null,
  profileError: null,
  ptyError: null,
  copyState: "idle" as const,
  onCopySuggestion: () => undefined,
};

function renderAttention(event: Event): string {
  return renderToStaticMarkup(
    <Notices {...baseProps} attention={toAttentionNotice(event)} />
  );
}

describe("Notices", () => {
  it("入力待ちでは入力先とターミナル操作を表示する", () => {
    const markup = renderAttention({
      ts: 1234,
      type: "stdout",
      summary: "質問への回答を待っている",
      detail: "Question 1/1 (1 unanswered)",
      priority: "urgent",
    });

    expect(markup).toContain("notices--has-attention");
    expect(markup).toContain("入力待ち");
    expect(markup).toContain("Managed Terminalを開いて入力");
    expect(markup).toContain("ターミナルへ移動");
    expect(markup).toContain("確認した");
  });

  it("実行エラーでは入力を促さず、確認操作を表示する", () => {
    const markup = renderAttention({
      ts: 1234,
      type: "error",
      summary: "エラーが出ている",
      detail: "command failed with exit code 1",
      priority: "urgent",
    });

    expect(markup).toContain("実行エラー");
    expect(markup).toContain("入力待ちではありません");
    expect(markup).not.toContain("ターミナルへ移動");
    expect(markup).toContain("エラーを確認した");
  });

  it("確認要求では承認のためのターミナル操作と確認済み操作を表示する", () => {
    const markup = renderAttention({
      ts: 1234,
      type: "stdout",
      summary: "コマンド実行の確認待ち",
      detail: "Would you like to run the following command?\npnpm test",
      priority: "urgent",
    });

    expect(markup).toContain("確認要求");
    expect(markup).toContain("確認・承認が必要");
    expect(markup).toContain("ターミナルへ移動");
    expect(markup).toContain("確認した");
  });

  it("長文でも原文を省略し、操作領域をDOMに残す", () => {
    const markup = renderAttention({
      ts: 1234,
      type: "error",
      summary: "エラーが出ている",
      detail: "long error ".repeat(200),
      priority: "urgent",
    });

    expect(markup).toContain("長文のため省略");
    expect(markup).toContain("エラーを確認した");
    expect(markup).toContain("notice__code");
  });

  it("確認済み状態では未確認バナーを描画しない", () => {
    const markup = renderToStaticMarkup(<Notices {...baseProps} attention={null} />);

    expect(markup).toBe("");
  });
});
