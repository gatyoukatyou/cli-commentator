export type TerminalBufferLineLike = {
  translateToString: (trimRight?: boolean) => string;
};

export type TerminalBufferLike = {
  length: number;
  getLine: (index: number) => TerminalBufferLineLike | undefined;
};

export function terminalBufferToText(buffer: TerminalBufferLike | undefined): string {
  if (!buffer) return "";

  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
  }

  return lines.join("\n").replace(/\n+$/, "");
}
