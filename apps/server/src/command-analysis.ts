import type { EventType } from "./types.js";

const SHELL_OPERATORS = new Set(["&&", "||", ";", "|"]);

function commandName(value: string): string {
  return value.replace(/\\/g, "/").split("/").at(-1)?.toLowerCase() ?? value.toLowerCase();
}

export function unwrapCommandDetail(detail: string): string {
  const wrapped = detail.match(/^[⏺•]\s*(?:Bash|Grep|Glob)\((.*)\)$/s);
  return (wrapped?.[1] ?? detail).trim().replace(/^>\s+/, "");
}

export function tokenizeShellCommand(command: string): string[] | null {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;

  const pushToken = () => {
    if (token) tokens.push(token);
    token = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      pushToken();
      continue;
    }
    const pair = command.slice(index, index + 2);
    if (pair === "&&" || pair === "||") {
      pushToken();
      tokens.push(pair);
      index += 1;
      continue;
    }
    if (char === ";" || char === "|") {
      pushToken();
      tokens.push(char);
      continue;
    }
    token += char;
  }

  if (quote || escaped) return null;
  pushToken();
  return tokens;
}

function commandSegments(command: string): string[][] {
  const tokens = tokenizeShellCommand(command);
  if (!tokens) return [];

  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (SHELL_OPERATORS.has(token)) segments.push([]);
    else segments.at(-1)?.push(token);
  }
  return segments.filter((segment) => segment.length > 0);
}

function commandInvocations(command: string): Array<{ segment: string[]; start: number; executable: string }> {
  return commandSegments(command).map((segment) => {
    const start = executableIndex(segment);
    return { segment, start, executable: commandName(segment[start] ?? "") };
  });
}

function executableIndex(segment: string[]): number {
  let index = 0;
  while (index < segment.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[index])) index += 1;
  if (commandName(segment[index] ?? "") === "env") {
    index += 1;
    while (index < segment.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[index]) || segment[index].startsWith("-"))) {
      index += 1;
    }
  }
  if (["command", "sudo"].includes(commandName(segment[index] ?? ""))) index += 1;
  return index;
}

const PACKAGE_MANAGER_VALUE_OPTIONS: Record<string, Set<string>> = {
  pnpm: new Set(["-C", "--dir", "--filter", "--workspace-concurrency", "--config"]),
  npm: new Set(["-w", "--workspace", "--prefix"]),
  yarn: new Set(["--cwd"]),
};

function skipPackageManagerOptions(manager: string, tokens: string[], start: number): number {
  const valueOptions = PACKAGE_MANAGER_VALUE_OPTIONS[manager] ?? new Set<string>();
  let index = start;
  while (index < tokens.length && tokens[index].startsWith("-")) {
    const option = tokens[index];
    index += 1;
    if (valueOptions.has(option) && index < tokens.length) index += 1;
  }
  return index;
}

function isRunnerInvocation(tokens: string[], start: number): boolean {
  const executable = commandName(tokens[start] ?? "");
  if (["vitest", "jest", "tsc", "typecheck"].includes(executable)) return true;
  if (executable === "playwright") return tokens[start + 1] === "test";
  return false;
}

function isPackageTestInvocation(segment: string[], start: number): boolean {
  const manager = commandName(segment[start] ?? "");
  let index = skipPackageManagerOptions(manager, segment, start + 1);
  let action = segment[index]?.toLowerCase();

  if (manager === "yarn" && action === "workspace") {
    index += 2;
    action = segment[index]?.toLowerCase();
  }

  if (action === "test" || action?.startsWith("test:")) return true;
  if (action === "run") return /^test(?::|$)/i.test(segment[index + 1] ?? "");
  if (manager === "npx") return isRunnerInvocation(segment, index);
  if (action === "exec") {
    index += 1;
    while (segment[index]?.startsWith("-")) index += 1;
    return isRunnerInvocation(segment, index);
  }
  return manager === "yarn" && isRunnerInvocation(segment, index);
}

export function isTestExecution(detail: string): boolean {
  const command = unwrapCommandDetail(detail);
  return commandInvocations(command).some(({ segment, start, executable }) => {
    if (isRunnerInvocation(segment, start)) return true;
    if (["pnpm", "npm", "yarn", "npx"].includes(executable)) {
      return isPackageTestInvocation(segment, start);
    }
    return false;
  });
}

export function isSearchExecution(command: string): boolean {
  return commandInvocations(unwrapCommandDetail(command))
    .some(({ executable }) => executable === "rg" || executable === "grep");
}

export function isFileListExecution(command: string): boolean {
  return commandInvocations(unwrapCommandDetail(command)).some(({ segment, start, executable }) =>
    executable === "find" || executable === "fd" || (executable === "rg" && segment.slice(start + 1).includes("--files"))
  );
}

const SEARCH_VALUE_OPTIONS = new Set([
  "-A", "-B", "-C", "-g", "-j", "-m", "-t", "-T",
  "--after-context", "--before-context", "--context", "--encoding", "--engine",
  "--exclude", "--exclude-dir", "--glob", "--include", "--max-count", "--max-depth",
  "--max-filesize", "--sort", "--sortr", "--threads", "--type", "--type-not",
]);

const SEARCH_BOOLEAN_OPTIONS = new Set([
  "-F", "-H", "-I", "-L", "-N", "-P", "-R", "-S", "-U", "-V", "-b", "-c", "-h",
  "-i", "-l", "-n", "-o", "-q", "-s", "-u", "-v", "-w", "-x",
  "--case-sensitive", "--count", "--files-with-matches", "--fixed-strings", "--heading",
  "--hidden", "--ignore-case", "--invert-match", "--line-number", "--no-heading", "--no-ignore",
  "--only-matching", "--quiet", "--recursive", "--smart-case", "--text", "--version", "--word-regexp",
]);

function searchPatternFromSegment(segment: string[], executableAt: number): string | null {
  let index = executableAt + 1;
  while (index < segment.length) {
    const token = segment[index];
    if (token === "--") return segment[index + 1] || null;
    if (token === "-e" || token === "--regexp") return segment[index + 1] || null;
    if (token.startsWith("--regexp=")) return token.slice("--regexp=".length) || null;
    if (token === "-f" || token === "--file" || token.startsWith("--file=")) return null;
    if (SEARCH_VALUE_OPTIONS.has(token)) {
      index += 2;
      continue;
    }
    if ([...SEARCH_VALUE_OPTIONS].some((option) => option.startsWith("--") && token.startsWith(`${option}=`))) {
      index += 1;
      continue;
    }
    if (/^-g.+/.test(token) || /^-[ABCjmtT]\d?.+/.test(token)) {
      index += 1;
      continue;
    }
    if (SEARCH_BOOLEAN_OPTIONS.has(token) || (/^-[A-Za-z]+$/.test(token) && [...token.slice(1)].every((flag) => SEARCH_BOOLEAN_OPTIONS.has(`-${flag}`)))) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) return null;
    return token;
  }
  return null;
}

export function extractSearchPattern(detail: string): string | null {
  const command = unwrapCommandDetail(detail);
  for (const { segment, start, executable } of commandInvocations(command)) {
    if (["rg", "grep"].includes(executable)) {
      return searchPatternFromSegment(segment, start);
    }
  }
  return null;
}

export function representativeGlossaryTerm(detail: string, eventType?: EventType): string | null {
  const command = unwrapCommandDetail(detail);
  const invocations = commandInvocations(command);

  if (eventType === "search") {
    return invocations.find(({ executable }) => executable === "rg") ? "rg" : null;
  }
  if (eventType === "git") return invocations.some(({ executable }) => executable === "git") ? "git" : null;
  if (eventType === "github") return invocations.some(({ executable }) => executable === "gh") ? "gh" : null;
  if (eventType === "test") {
    for (const { segment, start, executable } of invocations) {
      if (["vitest", "jest", "playwright", "tsc", "typecheck"].includes(executable)) return executable;
      if (["pnpm", "npm", "yarn", "npx"].includes(executable)) {
        const runner = segment.find((token) => ["vitest", "jest", "playwright", "tsc", "typecheck"].includes(commandName(token)));
        return runner ? commandName(runner) : executable === "npx" ? null : executable;
      }
    }
  }
  if (["install", "build", "lint", "server"].includes(eventType ?? "")) {
    return invocations.find(({ executable }) => ["pnpm", "npm", "yarn"].includes(executable))?.executable ?? null;
  }
  if (eventType === "error" && /\b(?:tsc|typecheck|TS\d{4,5})\b/i.test(detail)) return "tsc";

  if (/^[⏺•]\s*(?:Bash|Grep|Glob)\(/.test(detail)) return null;
  const contextualTokens = tokenizeShellCommand(detail) ?? [];
  return contextualTokens.find((token) => !token.includes("/") && /^(?:rg|tsc|typecheck|pnpm|npm|yarn|vite|tsx|node-pty|pty|ws|websocket|playwright|vitest|jest|gh|git)$/i.test(token))?.toLowerCase() ?? null;
}
