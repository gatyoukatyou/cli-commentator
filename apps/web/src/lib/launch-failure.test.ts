import { describe, expect, it } from "vitest";
import { getLaunchFailureGuidance } from "./launch-failure";

describe("getLaunchFailureGuidance", () => {
  const attempt = {
    cmd: "codex",
    args: ["--no-alt-screen"],
    cwd: "/Users/home/AION_project/repos/n8n-workflows",
  };

  it("classifies missing working directory errors", () => {
    const guidance = getLaunchFailureGuidance("Working directory not found: /tmp/missing", attempt);
    expect(guidance.summary).toContain("作業ディレクトリ");
    expect(guidance.diagnostics).toContain("cmd=codex");
  });

  it("classifies missing command errors", () => {
    const guidance = getLaunchFailureGuidance("spawn codex ENOENT", attempt);
    expect(guidance.summary).toContain("起動コマンド");
    expect(guidance.hints[0]).toContain("PATH");
  });
});
