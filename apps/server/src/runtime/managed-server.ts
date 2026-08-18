export function isManagedServer(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.CLI_COMMENTATOR_MANAGED_SERVER?.trim() === "1";
}
