export type LineBufferState = {
  completeChunk: string;
  pending: string;
};

export function consumeCompleteLines(pending: string, chunk: string): LineBufferState {
  const merged = `${pending}${chunk}`;
  if (!merged) {
    return { completeChunk: "", pending: "" };
  }

  const lines = merged.split(/\r?\n/);
  const nextPending = lines.pop() ?? "";

  return {
    completeChunk: lines.join("\n"),
    pending: nextPending,
  };
}
