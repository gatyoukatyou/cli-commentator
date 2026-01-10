import type { EventType } from "../types.js";

export type Rule = {
  id: string;
  priority: number;
  re: RegExp;
  type: EventType;
  summary: string;
};

export type RuleSet = {
  id: "claude" | "codex" | "generic";
  label: string;
  rules: Rule[];
  detect?: (line: string) => boolean;
};
