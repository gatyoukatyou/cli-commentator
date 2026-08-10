export const TERMINAL_INTERRUPT_SEQUENCE = "\u0003";
export const TERMINAL_INTERRUPT_LABEL = "実行を中断（Ctrl+C）";

export function sendTerminalInterrupt(onTerminalData: (data: string) => void): void {
  onTerminalData(TERMINAL_INTERRUPT_SEQUENCE);
}
