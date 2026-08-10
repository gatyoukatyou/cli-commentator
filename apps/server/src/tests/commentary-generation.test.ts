import { describe, expect, it } from "vitest";
import {
  broadcastIfCurrentGeneration,
  createCommentaryGeneration,
} from "../runtime/commentary-generation.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("commentary generation", () => {
  it("suppresses delayed managed PTY exit commentary after same-CLI restart", async () => {
    const generations = createCommentaryGeneration();
    const sent: string[] = [];
    const oldCommentary = deferred<string>();
    const oldGeneration = generations.invalidate();

    broadcastIfCurrentGeneration(oldCommentary.promise, generations, oldGeneration, (payload) => {
      sent.push(payload);
    });

    // Managed PTY exit has started commentary; restarting the same CLI invalidates it
    // before ptyRestart is sent and before the replacement PTY is created.
    generations.invalidate();
    generations.invalidate();
    oldCommentary.resolve("old session done");
    await flushPromises();

    expect(sent).toEqual([]);
  });

  it("broadcasts new-session commentary and one non-restarted managed exit commentary", async () => {
    const generations = createCommentaryGeneration();
    const sent: string[] = [];
    const oldCommentary = deferred<string>();
    const oldGeneration = generations.invalidate();

    broadcastIfCurrentGeneration(oldCommentary.promise, generations, oldGeneration, (payload) => {
      sent.push(payload);
    });
    oldCommentary.resolve("old session done");
    await flushPromises();
    expect(sent).toEqual(["old session done"]);

    const newGeneration = generations.invalidate();
    const newCommentary = deferred<string>();
    broadcastIfCurrentGeneration(newCommentary.promise, generations, newGeneration, (payload) => {
      sent.push(payload);
    });
    newCommentary.resolve("new session started");
    await flushPromises();

    expect(sent).toEqual(["old session done", "new session started"]);
  });
});
