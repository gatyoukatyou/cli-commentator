import type { Rule, RuleSet } from "./types.js";
import { claudeRuleset } from "./claude.js";
import { codexRuleset } from "./codex.js";
import { genericRuleset } from "./generic.js";

const RULESETS: RuleSet[] = [codexRuleset, claudeRuleset, genericRuleset];
const RULESET_MAP = new Map<string, RuleSet>(RULESETS.map((ruleset) => [ruleset.id, ruleset]));
const SORTED_RULES = new Map<string, Rule[]>();

function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => b.priority - a.priority);
}

function selectRuleset(line: string, sourceEnv?: string): RuleSet {
  const source = (sourceEnv ?? "auto").trim().toLowerCase();

  if (source === "auto" || source.length === 0) {
    for (const ruleset of RULESETS) {
      if (ruleset.detect && ruleset.detect(line)) return ruleset;
    }
    return genericRuleset;
  }

  return RULESET_MAP.get(source) ?? genericRuleset;
}

export function rulesForLine(line: string, sourceEnv?: string): Rule[] {
  const ruleset = selectRuleset(line, sourceEnv);
  const cached = SORTED_RULES.get(ruleset.id);
  if (cached) return cached;

  const sorted = sortRules(ruleset.rules);
  SORTED_RULES.set(ruleset.id, sorted);
  return sorted;
}
