import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getEnvFilePath, loadEnvironment } from "../env.js";

describe("getEnvFilePath", () => {
  it("uses the explicit override when configured", () => {
    expect(getEnvFilePath({ CLI_COMMENTATOR_ENV_FILE: "/tmp/cli-commentator-env" })).toBe(
      "/tmp/cli-commentator-env",
    );
  });

  it("uses XDG_CONFIG_HOME when available", () => {
    expect(getEnvFilePath({ XDG_CONFIG_HOME: "/tmp/config" })).toBe(
      path.join("/tmp/config", "cli-commentator", "env"),
    );
  });

  it("uses the user config directory by default", () => {
    expect(getEnvFilePath({})).toBe(path.join(os.homedir(), ".config", "cli-commentator", "env"));
  });

  it("loads values into the supplied environment object", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-commentator-env-"));
    const envPath = path.join(tempDir, "env");
    const env: NodeJS.ProcessEnv = { CLI_COMMENTATOR_ENV_FILE: envPath };

    fs.writeFileSync(envPath, "TARGET_CMD=bash\n");
    try {
      loadEnvironment(env);
      expect(env.TARGET_CMD).toBe("bash");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
