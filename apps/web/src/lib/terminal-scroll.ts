export type TerminalScrollPosition = {
  viewportY: number;
  baseY: number;
};

export function isAtTerminalLatest({ viewportY, baseY }: TerminalScrollPosition): boolean {
  return viewportY >= baseY;
}
