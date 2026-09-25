export const TERMINAL_INTERRUPT_SEQUENCE = "\u0003";
export const TERMINAL_INTERRUPT_LABEL = "実行を中断（Ctrl+C）";
export const TERMINAL_FORCE_STOP_WINDOW_MS = 10_000;
export const TERMINAL_FORCE_STOP_LABEL = "セッションを強制終了";

export function sendTerminalInterrupt(onTerminalData: (data: string) => void): void {
  onTerminalData(TERMINAL_INTERRUPT_SEQUENCE);
}

export type TerminalInterruptDecision = "interrupt" | "force-stop";

export function decideTerminalInterrupt(input: {
  now: number;
  lastInterruptAt: number | null;
  windowMs?: number;
}): TerminalInterruptDecision {
  const windowMs = input.windowMs ?? TERMINAL_FORCE_STOP_WINDOW_MS;
  const last = input.lastInterruptAt;
  return last !== null && input.now - last < windowMs ? "force-stop" : "interrupt";
}
