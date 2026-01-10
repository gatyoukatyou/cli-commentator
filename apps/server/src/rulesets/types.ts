import type { EventType } from "../types.js";

export type RuleSetId = "claude" | "codex" | "generic";

export type Rule = {
  id: string;
  priority: number;
  re: RegExp;
  type: EventType;
  summary: string;
};

export type RuleSet = {
  id: RuleSetId;
  label: string;
  rules: Rule[];
  detect?: (line: string) => boolean;
};
