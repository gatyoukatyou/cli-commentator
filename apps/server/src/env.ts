import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

const DEFAULT_CONFIG_HOME = path.join(os.homedir(), ".config");

export function getEnvFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configuredPath = env.CLI_COMMENTATOR_ENV_FILE?.trim();
  if (configuredPath) return configuredPath;

  const configHome = env.XDG_CONFIG_HOME?.trim() || DEFAULT_CONFIG_HOME;
  return path.join(configHome, "cli-commentator", "env");
}

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  dotenv.config({ path: getEnvFilePath(env), processEnv: env });
}
