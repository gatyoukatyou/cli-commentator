import type { Rule, RuleSet, RuleSetId } from "./types.js";
import { claudeRuleset } from "./claude.js";
import { codexRuleset } from "./codex.js";
import { genericRuleset } from "./generic.js";
import { createAutoDetector } from "./detect.js";

const RULESETS: RuleSet[] = [codexRuleset, claudeRuleset, genericRuleset];
const RULESET_MAP = new Map<string, RuleSet>(RULESETS.map((ruleset) => [ruleset.id, ruleset]));
const SORTED_RULES = new Map<string, Rule[]>();

const autoDetector = createAutoDetector();

function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => b.priority - a.priority);
}

function rulesetById(id: string): RuleSet {
  return RULESET_MAP.get(id) ?? genericRuleset;
}

function getAutoRuleset(line: string): RuleSet {
  const decided = autoDetector.update(line);
  if (decided) return rulesetById(decided);
  return genericRuleset;
}

function selectedRuleset(line: string, sourceEnv?: string): RuleSet {
  const source = (sourceEnv ?? "auto").trim().toLowerCase();

  if (source && source !== "auto") {
    return rulesetById(source);
  }

  return getAutoRuleset(line);
}

export function resetAutoDetection() {
  autoDetector.reset();
}

export function getAutoDetectedSource(): RuleSetId | null {
  return autoDetector.get();
}

export function rulesForLine(line: string, sourceEnv?: string): Rule[] {
  const ruleset = selectedRuleset(line, sourceEnv);
  const cached = SORTED_RULES.get(ruleset.id);
  if (cached) return cached;

  const sorted = sortRules(ruleset.rules);
  SORTED_RULES.set(ruleset.id, sorted);
  return sorted;
}
