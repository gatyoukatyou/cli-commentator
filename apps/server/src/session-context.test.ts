import { describe, expect, it } from "vitest";
import type { Event } from "./types.js";
import { createSessionContext } from "./session-context.js";
import { createCommentaryGate } from "./event-priority.js";

function event(type: Event["type"], detail?: string, summary: string = type): Event {
  return { ts: 1, type, summary, detail };
}

describe("SessionContext", () => {
  it("starts unknown without inventing a task", () => {
    expect(createSessionContext().snapshot()).toMatchObject({
      task: { objective: null, userPrompt: null, sessionLabel: null, source: null },
      target: null,
      recentEvents: [],
      phase: "unknown",
      previousPhase: "unknown",
      phaseChanged: false,
      humanRequired: false,
      sequence: 0,
    });
  });

  it("sets sanitized, bounded task context", () => {
    const context = createSessionContext();
    context.setTaskContext({
      objective: `調査 sk-abcdefghijklmnopqrstuvwxyz123456 ${"x".repeat(400)}`,
      userPrompt: "実況の流れを確認してください",
      source: "fixture",
    });

    const task = context.snapshot().task;
    expect(task.source).toBe("fixture");
    expect(task.objective).toContain("sk-[REDACTED]");
    expect(task.objective?.length).toBeLessThanOrEqual(320);
    expect(task.userPrompt).toBe("実況の流れを確認してください");
  });

  it("buffers trusted interactive input until a newline", () => {
    const context = createSessionContext();
    context.reset({ acceptsHumanInput: true });
    context.observeInput("実況の流れを");
    expect(context.snapshot().task.objective).toBeNull();
    context.observeInput("確認してください\r");
    expect(context.snapshot().task).toEqual({
      objective: "実況の流れを確認してください",
      userPrompt: "実況の流れを確認してください",
      sessionLabel: null,
      source: "human_input",
    });
  });

  it("does not accept input when the session is not a trusted human-prompt CLI", () => {
    const context = createSessionContext();
    context.observeInput("もっともらしい目的\n");
    expect(context.snapshot().task.objective).toBeNull();
  });

  it("keeps a sanitized preset name as a session label rather than a task objective", () => {
    const context = createSessionContext();
    context.reset({ presetName: "安全な調査プリセット sk-abcdefghijklmnopqrstuvwxyz123456" });
    expect(context.snapshot().task).toEqual({
      objective: null,
      userPrompt: null,
      sessionLabel: "安全な調査プリセット sk-[REDACTED]",
      source: "preset",
    });
  });

  it("starts a fresh task flow for a confirmed instruction in the same PTY", () => {
    const context = createSessionContext();
    context.reset({ acceptsHumanInput: true, presetName: "開発用" });
    context.observeInput("最初の変更を公開してください\n");
    context.observeEvent(event("write", "⏺ Update(src/old.ts)"));
    context.observeEvent(event("git", "⏺ Bash(git push origin feat/old)"));

    context.observeInput("次のIssueを調査してください\n");
    const fresh = context.snapshot();
    expect(fresh).toMatchObject({
      task: {
        objective: "次のIssueを調査してください",
        userPrompt: "次のIssueを調査してください",
        sessionLabel: "開発用",
        source: "human_input",
      },
      target: null,
      recentEvents: [],
      phase: "unknown",
      sequence: 0,
      humanRequired: false,
    });
    expect(context.observeEvent(event("search", "⏺ Grep(rg SessionContext apps/server/src)")).phase)
      .toBe("investigation");
  });

  it("bounds recent history to three through five entries", () => {
    const context = createSessionContext({ historyLimit: 3 });
    for (let index = 0; index < 7; index += 1) {
      context.observeEvent(event("read", `⏺ Read(src/file-${index}.ts)`));
    }
    expect(context.snapshot().recentEvents).toHaveLength(3);
    expect(context.snapshot().recentEvents.map((item) => item.sequence)).toEqual([5, 6, 7]);
  });

  it("updates file and module targets", () => {
    const context = createSessionContext();
    expect(context.observeEvent(event("read", "⏺ Read(apps/server/src/index.ts)")).target)
      .toBe("apps/server/src/index.ts");
    expect(context.observeEvent(event("write", "⏺ Update(packages/shared/src/protocol.ts)")).target)
      .toBe("packages/shared/src/protocol.ts");
  });

  it("follows investigation to editing to verification to publishing", () => {
    const context = createSessionContext();
    expect(context.observeEvent(event("search", "⏺ Grep(rg SessionContext apps/server/src)")).phase)
      .toBe("investigation");
    expect(context.observeEvent(event("read", "⏺ Read(apps/server/src/index.ts)")).phaseChanged)
      .toBe(false);
    expect(context.observeEvent(event("write", "apply_patch")).phase).toBe("editing");
    expect(context.observeEvent(event("test", "pnpm -C apps/server test")).phase).toBe("verification");
    const published = context.observeEvent(event("git", "⏺ Bash(git push origin feat/context)"));
    expect(published).toMatchObject({
      phase: "publishing",
      previousPhase: "verification",
      phaseChanged: true,
    });
  });

  it("recognizes scoped package build and lint commands as verification", () => {
    const context = createSessionContext();
    context.observeEvent(event("write", "apply_patch"));
    expect(context.observeEvent(event("stdout", "⏺ Bash(pnpm -C apps/server build)")).phase)
      .toBe("verification");
    context.observeEvent(event("write", "apply_patch"));
    expect(context.observeEvent(event("stdout", "⏺ Bash(npm --workspace web run lint:check)")).phase)
      .toBe("verification");
  });

  it("does not treat package installation as verification", () => {
    const context = createSessionContext();
    expect(context.observeEvent(event("install", "⏺ Bash(pnpm install build)")).phase)
      .toBe("unknown");
  });

  it("does not move an active phase back for a supporting read or git status", () => {
    const context = createSessionContext();
    context.observeEvent(event("write", "apply_patch"));
    expect(context.observeEvent(event("read", "⏺ Read(src/check.ts)")).phase).toBe("editing");
    expect(context.observeEvent(event("git", "⏺ Bash(git status --short)")).phase).toBe("editing");
    context.observeEvent(event("test", "pnpm test"));
    expect(context.observeEvent(event("search", "⏺ Grep(rg failure src)")).phase).toBe("verification");
  });

  it("enters waiting, marks explicit HUMAN need, and clears it on work", () => {
    const context = createSessionContext();
    context.observeEvent(event("write", "apply_patch"));
    const waiting = context.observeEvent(event("stdout", undefined, "コマンド実行の確認待ち"));
    expect(waiting).toMatchObject({ phase: "waiting", humanRequired: true });

    const resumed = context.observeEvent(event("write", "apply_patch"));
    expect(resumed).toMatchObject({ phase: "editing", humanRequired: false });
  });

  it("treats confirmed input during waiting as a response without replacing the objective", () => {
    const context = createSessionContext();
    context.reset({ acceptsHumanInput: true });
    context.observeInput("実況文脈を実装してください\n");
    context.observeEvent(event("write", "apply_patch"));
    context.observeEvent(event("stdout", undefined, "コマンド実行の確認待ち"));

    context.observeInput("承認します\n");
    expect(context.snapshot()).toMatchObject({
      task: { objective: "実況文脈を実装してください" },
      phase: "editing",
      previousPhase: "waiting",
      phaseChanged: true,
      humanRequired: false,
    });
  });

  it("does not infer waiting from keywords inside a search command", () => {
    const context = createSessionContext();
    const searched = context.observeEvent(
      event("search", '⏺ Grep(rg "確認待ち|承認待ち" apps/server/src)')
    );
    expect(searched).toMatchObject({ phase: "investigation", humanRequired: false });
  });

  it("treats silence as waiting without claiming HUMAN action is required", () => {
    const context = createSessionContext();
    context.observeEvent(event("search", "rg context src"));
    const waiting = context.observeEvent(event("stdout", "30000ms outputなし", "長考・沈黙が続いている"));
    expect(waiting).toMatchObject({ phase: "waiting", humanRequired: false });
    expect(context.observeEvent(event("read", "⏺ Read(src/index.ts)")).phase).toBe("investigation");
  });

  it("does not infer HUMAN action or a new phase from an ordinary error", () => {
    const context = createSessionContext();
    const failed = context.observeEvent(event("error", "test failed", "エラーが出ている"));
    expect(failed.humanRequired).toBe(false);
    expect(failed.phase).toBe("unknown");
  });

  it("treats mutating PR review and lifecycle commands as publishing", () => {
    const review = createSessionContext();
    expect(review.observeEvent(event("github", "⏺ Bash(gh pr review --approve 335)")).phase)
      .toBe("publishing");

    const close = createSessionContext();
    expect(close.observeEvent(event("github", "⏺ Bash(gh pr close 335)")).phase)
      .toBe("publishing");
  });

  it("resets all session state and keeps prior snapshots immutable", () => {
    const context = createSessionContext();
    context.setTaskContext({ objective: "目的", userPrompt: "依頼", source: "fixture" });
    const oldSnapshot = context.observeEvent(event("write", "⏺ Update(src/a.ts)"));
    context.observeEvent(event("test", "pnpm test"));
    context.reset();

    expect(oldSnapshot).toMatchObject({
      task: { objective: "目的" },
      phase: "editing",
      sequence: 1,
      target: "src/a.ts",
    });
    expect(context.snapshot()).toMatchObject({
      task: { objective: null },
      phase: "unknown",
      sequence: 0,
      target: null,
      recentEvents: [],
      humanRequired: false,
    });
    expect(Object.isFrozen(oldSnapshot)).toBe(true);
    expect(Object.isFrozen(oldSnapshot.recentEvents)).toBe(true);
  });

  it("suppresses repeated same-task progress for 30 seconds with an injected clock", () => {
    let now = 0;
    const context = createSessionContext({ now: () => now });
    context.setTaskContext({ objective: "同じ目的", source: "fixture" });
    expect(context.observeEvent(event("read", "⏺ Read(src/a.ts)")).speech).toMatchObject({
      disposition: "speak",
    });

    now = 1_000;
    expect(context.observeEvent(event("read", "⏺ Read(src/a.ts)")).speech).toEqual({
      disposition: "display_only",
      reason: "progress_interval",
    });

    now = 31_001;
    expect(context.observeEvent(event("read", "⏺ Read(src/a.ts)")).speech).toEqual({
      disposition: "speak",
      reason: "progress_refresh",
    });
  });

  it("speaks phase changes and new targets even within the progress interval", () => {
    let now = 0;
    const context = createSessionContext({ now: () => now });
    context.observeEvent(event("read", "⏺ Read(src/a.ts)"));
    now = 100;
    expect(context.observeEvent(event("read", "⏺ Read(src/b.ts)")).speech.reason)
      .toBe("new_target");
    now = 200;
    expect(context.observeEvent(event("write", "⏺ Update(src/b.ts)")).speech.reason)
      .toBe("phase_change");
  });

  it("keeps a target change pending when the commentary gate suppresses its event", () => {
    let now = 0;
    const context = createSessionContext({ now: () => now });
    const gate = createCommentaryGate({ intervalMs: 2_000, now: () => now });

    const first = event("read", "⏺ Read(src/a.ts)");
    expect(context.observeEvent(first, { commentaryEligible: gate.shouldEmit("progress") }).speech)
      .toMatchObject({ disposition: "speak", reason: "new_task" });

    now = 1_000;
    const gatedTargetChange = event("read", "⏺ Read(src/b.ts)");
    expect(gate.shouldEmit("progress")).toBe(false);
    expect(context.observeEvent(gatedTargetChange, { commentaryEligible: false })).toMatchObject({
      target: "src/b.ts",
      targetChanged: true,
    });

    now = 3_000;
    const nextEligible = event("read", "⏺ Read(src/b.ts)");
    expect(context.observeEvent(nextEligible, { commentaryEligible: gate.shouldEmit("progress") }).speech)
      .toEqual({ disposition: "speak", reason: "new_target" });
  });

  it("never suppresses urgent, HUMAN-required, failure, or completion events", () => {
    let now = 0;
    const context = createSessionContext({ now: () => now });
    const urgentError = { ...event("error", "failed", "エラーが出ている"), priority: "urgent" as const };
    expect(context.observeEvent(urgentError).speech).toMatchObject({
      disposition: "speak",
      reason: "urgent",
    });
    now = 1;
    expect(context.observeEvent(urgentError).speech.disposition).toBe("speak");
    expect(context.observeEvent(event("stdout", undefined, "コマンド実行の確認待ち")).speech)
      .toMatchObject({ disposition: "speak", reason: "human_required" });
    expect(context.observeEvent(event("done", undefined, "完了")).speech)
      .toMatchObject({ disposition: "speak", reason: "completion" });
  });

  it("speaks explicit success and failure outcomes without promoting success to urgent", () => {
    const context = createSessionContext();
    const succeeded = { ...event("test", "PASS 10 tests", "テスト成功"), priority: "progress" as const };
    expect(context.observeEvent(succeeded).speech).toMatchObject({
      disposition: "speak",
      reason: "success",
    });
    const failed = { ...event("test", "FAIL 1 test", "テスト失敗"), priority: "progress" as const };
    expect(context.observeEvent(failed).speech).toMatchObject({
      disposition: "speak",
      reason: "failure",
    });
  });

  it("distinguishes zero, non-zero, and unknown PTY exit codes", () => {
    expect(createSessionContext().observeEvent(event("done", undefined, "終了 code=0")).speech)
      .toEqual({ disposition: "speak", reason: "completion" });
    expect(createSessionContext().observeEvent(event("done", undefined, "終了 code=1")).speech)
      .toEqual({ disposition: "speak", reason: "failure" });
    expect(createSessionContext().observeEvent(event("done", undefined, "終了")).speech)
      .toEqual({ disposition: "speak", reason: "completion" });
  });

  it("emits each glossary note once per session and resets the history", () => {
    const context = createSessionContext();
    const search = event("search", "⏺ Grep(rg SessionContext apps/server/src)");
    expect(context.observeEvent(search).glossaryNotes).toEqual([
      "補足: rg はプロジェクト全体を高速検索するコマンド",
    ]);
    expect(context.observeEvent(search).glossaryNotes).toEqual([]);
    context.reset();
    expect(context.observeEvent(search).glossaryNotes).toHaveLength(1);
  });

  it("does not consume a glossary note when commentary is gated out", () => {
    const context = createSessionContext();
    const search = event("search", "⏺ Grep(rg SessionContext apps/server/src)");
    expect(context.observeEvent(search, { commentaryEligible: false }).glossaryNotes).toEqual([]);
    expect(context.observeEvent(search).glossaryNotes).toHaveLength(1);
  });

  it("resets speech suppression for a confirmed new task in the same PTY", () => {
    let now = 0;
    const context = createSessionContext({ now: () => now });
    context.reset({ acceptsHumanInput: true });
    context.observeInput("最初の調査です\n");
    context.observeEvent(event("read", "⏺ Read(src/a.ts)"));
    now = 100;
    expect(context.observeEvent(event("read", "⏺ Read(src/a.ts)")).speech.disposition)
      .toBe("display_only");
    context.observeInput("次の調査です\n");
    expect(context.observeEvent(event("read", "⏺ Read(src/a.ts)")).speech.disposition)
      .toBe("speak");
  });
});
