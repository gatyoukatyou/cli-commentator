import { appendFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHistoryEventId,
  createHistoryRecordId,
  createHistorySessionId,
  createHistorySpeechId,
} from "./ids.js";
import {
  DEFAULT_HISTORY_MAX_BYTES,
  DEFAULT_HISTORY_MAX_SESSION_BYTES,
  DEFAULT_HISTORY_RETENTION_DAYS,
  HistoryConsentError,
  HistoryStorageLimitError,
  HistoryStore,
} from "./store.js";
import {
  HISTORY_CONSENT_VERSION,
  HISTORY_SCHEMA_VERSION,
  type HistoryEventRecord,
} from "./types.js";

const temporaryDirectories: string[] = [];

async function makeStore(options: {
  now?: () => number;
  ids?: string[];
} = {}): Promise<{ store: HistoryStore; configDir: string }> {
  const configDir = await mkdtemp(path.join(tmpdir(), "cli-commentator-history-test-"));
  temporaryDirectories.push(configDir);
  const ids = [...(options.ids ?? [])];
  let generatedId = 0;
  const store = new HistoryStore({
    configDir,
    now: options.now,
    idFactory: () => ids.shift() ?? `generated-${generatedId++}`,
  });
  return { store, configDir };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function enableHistory(store: HistoryStore): Promise<void> {
  await store.updateSettings({
    enabled: true,
    consentVersion: HISTORY_CONSENT_VERSION,
  });
}

function eventRecord(sessionId: string, recordId = "record-1"): HistoryEventRecord {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    kind: "event",
    recordId,
    sessionId,
    eventId: "event-1",
    ts: 1000,
    eventType: "progress",
    priority: "normal",
    summary: "safe summary",
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("history ids", () => {
  it("creates opaque, server-side identifiers", () => {
    const ids = [
      createHistorySessionId(),
      createHistoryRecordId(),
      createHistoryEventId(),
      createHistorySpeechId(),
    ];

    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("HistoryStore", () => {
  it("returns disabled defaults without creating files", async () => {
    const { store, configDir } = await makeStore();
    const settings = await store.getSettings();

    expect(settings).toEqual({
      enabled: false,
      consentVersion: null,
      requiredConsentVersion: HISTORY_CONSENT_VERSION,
      retentionDays: DEFAULT_HISTORY_RETENTION_DAYS,
      maxBytes: DEFAULT_HISTORY_MAX_BYTES,
      maxSessionBytes: DEFAULT_HISTORY_MAX_SESSION_BYTES,
      updatedAt: 0,
    });
    expect(await exists(path.join(configDir, "settings"))).toBe(false);
    expect(await exists(path.join(configDir, "history"))).toBe(false);
    await expect(
      store.createSession({ provider: "rules", generationMode: "narration" }),
    ).resolves.toBeNull();
    expect(await exists(path.join(configDir, "history"))).toBe(false);
  });

  it("requires the current consent version before enabling saving", async () => {
    const { store, configDir } = await makeStore();

    await expect(store.updateSettings({ enabled: true })).rejects.toBeInstanceOf(
      HistoryConsentError,
    );
    expect(await exists(path.join(configDir, "settings", "history.json"))).toBe(false);

    const settings = await store.updateSettings({
      enabled: true,
      consentVersion: HISTORY_CONSENT_VERSION,
    });
    expect(settings.enabled).toBe(true);
    expect(JSON.parse(await readFile(path.join(configDir, "settings", "history.json"), "utf8"))).toEqual(settings);
    // Enabling consent writes only settings. Session files are still lazy.
    expect(await exists(path.join(configDir, "history"))).toBe(false);
  });

  it("creates a session and appends records only after consent", async () => {
    const { store, configDir } = await makeStore({ ids: ["session-one"] });
    await enableHistory(store);

    const session = await store.createSession({
      cliName: "Codex",
      provider: "opencode-go",
      model: "deepseek-v4-flash",
      generationMode: "narration",
      startedAt: 1000,
    });

    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe("session-one");
    expect(session?.storageFile).toBe("sessions/session-one.jsonl");
    expect(await exists(path.join(configDir, "history", "manifest.json"))).toBe(true);
    expect(await exists(path.join(configDir, "history", "sessions", "session-one.jsonl"))).toBe(true);

    await expect(store.appendRecord(eventRecord("session-one"))).resolves.toBe(true);
    await expect(store.readSessionRecords("session-one")).resolves.toHaveLength(1);

    const [listed] = await store.listSessions();
    expect(listed?.recordCount).toBe(1);
    expect(listed?.byteCount).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(path.join(configDir, "history", "manifest.json"), "utf8")).schemaVersion).toBe(HISTORY_SCHEMA_VERSION);
  });

  it("keeps sessions separate and rejects records after close", async () => {
    const { store } = await makeStore({ ids: ["session-one", "session-two"] });
    await enableHistory(store);
    await store.createSession({ provider: "rules", generationMode: "narration" });
    await store.createSession({ provider: "rules", generationMode: "narration" });

    await store.appendRecord(eventRecord("session-one", "record-one"));
    await store.appendRecord(eventRecord("session-two", "record-two"));
    await store.endSession("session-one", "completed", 2000);

    await expect(store.appendRecord(eventRecord("session-one", "record-three"))).rejects.toMatchObject({
      code: "session_closed",
    });
    expect(await store.readSessionRecords("session-one")).toHaveLength(1);
    expect(await store.readSessionRecords("session-two")).toHaveLength(1);
  });

  it("closes active sessions when saving is disabled", async () => {
    const { store } = await makeStore({ ids: ["session-one"] });
    await enableHistory(store);
    await store.createSession({ provider: "rules", generationMode: "narration" });

    await store.updateSettings({ enabled: false });
    const [session] = await store.listSessions();
    expect(session?.status).toBe("aborted");
    await expect(store.appendRecord(eventRecord("session-one"))).resolves.toBe(false);
  });

  it("rejects a duplicate server-generated session id", async () => {
    const { store } = await makeStore({ ids: ["session-one", "session-one"] });
    await enableHistory(store);
    await store.createSession({ provider: "rules", generationMode: "narration" });

    await expect(
      store.createSession({ provider: "rules", generationMode: "narration" }),
    ).rejects.toMatchObject({ code: "duplicate_session" });
  });

  it("ignores an incomplete final JSONL line but not middle corruption", async () => {
    const { store, configDir } = await makeStore({ ids: ["session-one"] });
    await enableHistory(store);
    await store.createSession({ provider: "rules", generationMode: "narration" });
    await store.appendRecord(eventRecord("session-one"));

    const sessionFile = path.join(configDir, "history", "sessions", "session-one.jsonl");
    await appendFile(sessionFile, '{"schemaVersion":1', "utf8");
    await expect(store.readSessionRecords("session-one")).resolves.toHaveLength(1);

    await writeFile(sessionFile, `not-json\n${JSON.stringify(eventRecord("session-one"))}\n`, "utf8");
    await expect(store.readSessionRecords("session-one")).rejects.toThrow();
  });

  it("does not resolve a session path from an untrusted session id", async () => {
    const { store, configDir } = await makeStore({ ids: ["session-one"] });
    await enableHistory(store);
    await store.createSession({ provider: "rules", generationMode: "narration" });

    await expect(store.readSessionRecords("../outside")).rejects.toMatchObject({
      code: "unknown_session",
    });

    const manifestPath = path.join(configDir, "history", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      sessions: Array<Record<string, unknown>>;
    };
    manifest.sessions[0]!.storageFile = "../outside.jsonl";
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await expect(store.readSessionRecords("session-one")).rejects.toMatchObject({
      code: "invalid_session_file",
    });
  });

  it("enforces per-session and total limits without writing an oversized record", async () => {
    const { store } = await makeStore({ ids: ["session-one"] });
    await enableHistory(store);
    await store.updateSettings({
      retentionDays: 30,
      maxBytes: 200,
      maxSessionBytes: 100,
    });
    await store.createSession({ provider: "rules", generationMode: "narration" });

    const record = eventRecord("session-one");
    await expect(store.appendRecord(record)).rejects.toBeInstanceOf(
      HistoryStorageLimitError,
    );
    expect(await store.readSessionRecords("session-one")).toHaveLength(0);
  });

  it("removes expired completed sessions and supports deletion", async () => {
    let clock = 0;
    const { store, configDir } = await makeStore({
      now: () => clock,
      ids: ["old-session", "new-session"],
    });
    await enableHistory(store);
    await store.createSession({ provider: "rules", generationMode: "narration" });
    await store.appendRecord(eventRecord("old-session"));
    await store.endSession("old-session", "completed", 1);

    clock = DEFAULT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000 + 10;
    await store.createSession({ provider: "rules", generationMode: "narration" });
    await store.enforceLimits();
    expect((await store.listSessions()).map((session) => session.sessionId)).toEqual([
      "new-session",
    ]);

    const deletion = await store.deleteAllSessions();
    expect(deletion.deletedSessions).toBe(1);
    expect(await exists(path.join(configDir, "history"))).toBe(false);
    expect((await store.getStorageStats()).sessionCount).toBe(0);
  });

  it("leaves no temporary manifest files after an atomic update", async () => {
    const { store, configDir } = await makeStore({ ids: ["session-one"] });
    await enableHistory(store);
    await store.createSession({ provider: "rules", generationMode: "narration" });

    const historyEntries = await readdir(path.join(configDir, "history"));
    const settingsEntries = await readdir(path.join(configDir, "settings"));
    expect(historyEntries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
    expect(settingsEntries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
  });
});
