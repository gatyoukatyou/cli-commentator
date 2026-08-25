import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { getConfigDir } from "../profile/store.js";
import {
  createHistoryRecordId,
  createHistorySessionId,
} from "./ids.js";
import {
  HISTORY_CONSENT_VERSION,
  HISTORY_SCHEMA_VERSION,
  type HistoryManifest,
  type HistoryRecord,
  type HistorySession,
  type HistorySessionId,
  type HistorySessionMetadata,
  type HistorySessionStatus,
  type HistorySettings,
  type HistorySettingsPatch,
  type HistoryStorageStats,
} from "./types.js";

const SETTINGS_DIRECTORY_NAME = "settings";
const HISTORY_DIRECTORY_NAME = "history";
const SESSIONS_DIRECTORY_NAME = "sessions";
const SETTINGS_FILE_NAME = "history.json";
const MANIFEST_FILE_NAME = "manifest.json";
const SESSION_FILE_PREFIX = `${SESSIONS_DIRECTORY_NAME}/`;
const SESSION_FILE_SUFFIX = ".jsonl";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_HISTORY_RETENTION_DAYS = 30;
export const DEFAULT_HISTORY_MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_HISTORY_MAX_SESSION_BYTES = 5 * 1024 * 1024;

export type HistoryPaths = {
  configDir: string;
  settingsDir: string;
  settingsFile: string;
  historyDir: string;
  manifestFile: string;
  sessionsDir: string;
};

export type HistoryStoreOptions = {
  /** Override the application config directory for tests. */
  configDir?: string;
  now?: () => number;
  idFactory?: () => string;
  logger?: Pick<Console, "warn">;
};

export class HistoryConsentError extends Error {
  readonly code = "consent_version_mismatch" as const;

  constructor() {
    super("History saving requires the current consent version");
    this.name = "HistoryConsentError";
  }
}

export class HistorySessionError extends Error {
  readonly code:
    | "unknown_session"
    | "session_closed"
    | "invalid_session_file"
    | "duplicate_session";

  constructor(
    code:
      | "unknown_session"
      | "session_closed"
      | "invalid_session_file"
      | "duplicate_session",
    message: string,
  ) {
    super(message);
    this.name = "HistorySessionError";
    this.code = code;
  }
}

export class HistoryStorageLimitError extends Error {
  readonly code = "storage_limit" as const;

  constructor(message: string) {
    super(message);
    this.name = "HistoryStorageLimitError";
  }
}

export function getHistoryPaths(configDir = getConfigDir()): HistoryPaths {
  const settingsDir = path.join(configDir, SETTINGS_DIRECTORY_NAME);
  const historyDir = path.join(configDir, HISTORY_DIRECTORY_NAME);

  return {
    configDir,
    settingsDir,
    settingsFile: path.join(settingsDir, SETTINGS_FILE_NAME),
    historyDir,
    manifestFile: path.join(historyDir, MANIFEST_FILE_NAME),
    sessionsDir: path.join(historyDir, SESSIONS_DIRECTORY_NAME),
  };
}

function defaultSettings(): HistorySettings {
  return {
    enabled: false,
    consentVersion: null,
    requiredConsentVersion: HISTORY_CONSENT_VERSION,
    retentionDays: DEFAULT_HISTORY_RETENTION_DAYS,
    maxBytes: DEFAULT_HISTORY_MAX_BYTES,
    maxSessionBytes: DEFAULT_HISTORY_MAX_SESSION_BYTES,
    updatedAt: 0,
  };
}

function emptyManifest(now: number): HistoryManifest {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: now,
    sessions: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isHistorySessionStatus(value: unknown): value is HistorySessionStatus {
  return value === "active" || value === "completed" || value === "aborted";
}

function isHistorySession(value: unknown): value is HistorySession {
  if (!isRecord(value)) return false;

  return (
    value.schemaVersion === HISTORY_SCHEMA_VERSION &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    typeof value.startedAt === "number" &&
    (value.endedAt === null || typeof value.endedAt === "number") &&
    isHistorySessionStatus(value.status) &&
    (value.cliName === null || typeof value.cliName === "string") &&
    typeof value.provider === "string" &&
    (value.model === null || typeof value.model === "string") &&
    typeof value.generationMode === "string" &&
    isNonNegativeInteger(value.recordCount) &&
    typeof value.byteCount === "number" &&
    Number.isInteger(value.byteCount) &&
    value.byteCount >= 0 &&
    typeof value.storageFile === "string"
  );
}

function isHistoryManifest(value: unknown): value is HistoryManifest {
  return (
    isRecord(value) &&
    value.schemaVersion === HISTORY_SCHEMA_VERSION &&
    typeof value.updatedAt === "number" &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isHistorySession)
  );
}

function isHistorySettings(value: unknown): value is HistorySettings {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    (value.consentVersion === null || isPositiveInteger(value.consentVersion)) &&
    value.requiredConsentVersion === HISTORY_CONSENT_VERSION &&
    isPositiveInteger(value.retentionDays) &&
    isPositiveInteger(value.maxBytes) &&
    isPositiveInteger(value.maxSessionBytes) &&
    value.maxSessionBytes <= value.maxBytes &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt)
  );
}

function isValidSessionStorageFile(storageFile: string): boolean {
  return new RegExp(
    `^${SESSION_FILE_PREFIX.replace("/", "\\/")}[A-Za-z0-9._-]+${SESSION_FILE_SUFFIX.replace(".", "\\.")}$`,
  ).test(storageFile);
}

function getRelativeSessionFile(sessionId: HistorySessionId): string {
  return `${SESSION_FILE_PREFIX}${sessionId}${SESSION_FILE_SUFFIX}`;
}

function validateHistoryRecord(record: HistoryRecord): void {
  if (
    !isRecord(record) ||
    record.schemaVersion !== HISTORY_SCHEMA_VERSION ||
    typeof record.recordId !== "string" ||
    record.recordId.length === 0 ||
    typeof record.sessionId !== "string" ||
    record.sessionId.length === 0 ||
    typeof record.ts !== "number" ||
    !Number.isFinite(record.ts) ||
    (record.kind !== "event" &&
      record.kind !== "commentary" &&
      record.kind !== "tts")
  ) {
    throw new TypeError("Invalid history record");
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(directory: string, mode: number): Promise<void> {
  await mkdir(directory, { recursive: true, mode });
  try {
    await chmod(directory, mode);
  } catch {
    // chmod is best effort on platforms/filesystems that do not support it.
  }
}

async function writeAtomic(
  filePath: string,
  content: string,
  mode: number,
): Promise<void> {
  const temporaryPath = `${filePath}.${createHistoryRecordId()}.tmp`;

  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode });
    try {
      await chmod(temporaryPath, mode);
    } catch {
      // chmod is best effort on platforms/filesystems that do not support it.
    }
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function parseJsonLines(content: string): HistoryRecord[] {
  if (content.length === 0) return [];

  const lines = content.split("\n");
  const records: HistoryRecord[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.replace(/\r$/, "") ?? "";
    if (line.length === 0) continue;

    try {
      const record = JSON.parse(line) as HistoryRecord;
      validateHistoryRecord(record);
      records.push(record);
    } catch (error) {
      // A crash can leave only the final JSONL line incomplete. Ignore that
      // line, but never silently skip corruption in the middle of a session.
      if (index === lines.length - 1) continue;
      throw error;
    }
  }

  return records;
}

export class HistoryStore {
  private readonly paths: HistoryPaths;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly logger: Pick<Console, "warn">;
  private operation = Promise.resolve();

  constructor(options: HistoryStoreOptions = {}) {
    this.paths = getHistoryPaths(options.configDir);
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? createHistorySessionId;
    this.logger = options.logger ?? console;
  }

  getPaths(): HistoryPaths {
    return { ...this.paths };
  }

  async getSettings(): Promise<HistorySettings> {
    return this.readSettings();
  }

  async updateSettings(patch: HistorySettingsPatch): Promise<HistorySettings> {
    return this.withLock(async () => {
      const current = await this.readSettings();
      const next: HistorySettings = {
        ...current,
        ...patch,
        requiredConsentVersion: HISTORY_CONSENT_VERSION,
        updatedAt: this.now(),
      };

      this.validateSettings(next);
      if (next.enabled && next.consentVersion !== HISTORY_CONSENT_VERSION) {
        throw new HistoryConsentError();
      }

      if (current.enabled && !next.enabled) {
        const manifest = await this.readManifest();
        let changed = false;
        for (const session of manifest.sessions) {
          if (session.status === "active") {
            session.status = "aborted";
            session.endedAt = this.now();
            changed = true;
          }
        }
        if (changed) {
          manifest.updatedAt = this.now();
          await this.writeManifest(manifest);
        }
      }

      await ensureDirectory(this.paths.settingsDir, 0o700);
      await writeAtomic(
        this.paths.settingsFile,
        JSON.stringify(next, null, 2),
        0o600,
      );
      return next;
    });
  }

  /**
   * Start a persisted session only after consent has enabled history saving.
   * Returns null while saving is disabled without creating any history files.
   */
  async createSession(
    metadata: HistorySessionMetadata,
  ): Promise<HistorySession | null> {
    return this.withLock(async () => {
      const settings = await this.readSettings();
      if (!settings.enabled) return null;

      await ensureDirectory(this.paths.historyDir, 0o700);
      await ensureDirectory(this.paths.sessionsDir, 0o700);

      const sessionId = this.idFactory() as HistorySessionId;
      if (this.findSession(await this.readManifest(), sessionId)) {
        throw new HistorySessionError(
          "duplicate_session",
          `History session id is already in use: ${sessionId}`,
        );
      }
      const storageFile = getRelativeSessionFile(sessionId);
      const sessionFile = this.resolveSessionFile(storageFile);
      const session: HistorySession = {
        schemaVersion: HISTORY_SCHEMA_VERSION,
        sessionId,
        startedAt: metadata.startedAt ?? this.now(),
        endedAt: null,
        status: "active",
        cliName: metadata.cliName ?? null,
        provider: metadata.provider,
        model: metadata.model ?? null,
        generationMode: metadata.generationMode,
        recordCount: 0,
        byteCount: 0,
        storageFile,
      };

      await writeFile(sessionFile, "", { encoding: "utf8", mode: 0o600 });
      try {
        await chmod(sessionFile, 0o600);
      } catch {
        // chmod is best effort on platforms/filesystems that do not support it.
      }

      const manifest = await this.readManifest();
      manifest.sessions.push(session);
      manifest.updatedAt = this.now();
      await this.writeManifest(manifest);
      return session;
    });
  }

  async appendRecord(record: HistoryRecord): Promise<boolean> {
    return this.withLock(async () => {
      const settings = await this.readSettings();
      if (!settings.enabled) return false;

      validateHistoryRecord(record);
      const manifest = await this.readManifest();
      const session = this.findSession(manifest, record.sessionId);
      if (!session) {
        throw new HistorySessionError(
          "unknown_session",
          `Unknown history session: ${record.sessionId}`,
        );
      }
      if (session.status !== "active") {
        throw new HistorySessionError(
          "session_closed",
          `History session is already closed: ${record.sessionId}`,
        );
      }

      const serialized = `${JSON.stringify(record)}\n`;
      const recordBytes = Buffer.byteLength(serialized, "utf8");
      if (recordBytes > settings.maxSessionBytes) {
        throw new HistoryStorageLimitError(
          "History record exceeds the per-session storage limit",
        );
      }
      if (session.byteCount + recordBytes > settings.maxSessionBytes) {
        throw new HistoryStorageLimitError(
          "History session reached the per-session storage limit",
        );
      }

      await this.pruneLocked(settings, manifest, recordBytes, record.sessionId);
      const sessionFile = this.resolveSessionFile(session.storageFile);
      await appendFile(sessionFile, serialized, { encoding: "utf8", mode: 0o600 });
      try {
        await chmod(sessionFile, 0o600);
      } catch {
        // chmod is best effort on platforms/filesystems that do not support it.
      }

      session.recordCount += 1;
      session.byteCount += recordBytes;
      manifest.updatedAt = this.now();
      await this.writeManifest(manifest);
      return true;
    });
  }

  async endSession(
    sessionId: HistorySessionId,
    status: Exclude<HistorySessionStatus, "active">,
    endedAt = this.now(),
  ): Promise<HistorySession> {
    return this.withLock(async () => {
      const manifest = await this.readManifest();
      const session = this.findSession(manifest, sessionId);
      if (!session) {
        throw new HistorySessionError(
          "unknown_session",
          `Unknown history session: ${sessionId}`,
        );
      }

      if (session.status === "active") {
        session.status = status;
        session.endedAt = endedAt;
        manifest.updatedAt = this.now();
        await this.writeManifest(manifest);
      }
      return { ...session };
    });
  }

  async listSessions(): Promise<HistorySession[]> {
    const manifest = await this.readManifest();
    return manifest.sessions
      .slice()
      .sort((left, right) => right.startedAt - left.startedAt)
      .map((session) => ({ ...session }));
  }

  async readSessionRecords(sessionId: HistorySessionId): Promise<HistoryRecord[]> {
    const manifest = await this.readManifest();
    const session = this.findSession(manifest, sessionId);
    if (!session) {
      throw new HistorySessionError(
        "unknown_session",
        `Unknown history session: ${sessionId}`,
      );
    }

    const sessionFile = this.resolveSessionFile(session.storageFile);
    let content: string;
    try {
      content = await readFile(sessionFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return parseJsonLines(content);
  }

  async deleteSession(sessionId: HistorySessionId): Promise<number> {
    return this.withLock(async () => {
      const manifest = await this.readManifest();
      const session = this.findSession(manifest, sessionId);
      if (!session) {
        throw new HistorySessionError(
          "unknown_session",
          `Unknown history session: ${sessionId}`,
        );
      }

      await rm(this.resolveSessionFile(session.storageFile), { force: true });
      manifest.sessions = manifest.sessions.filter(
        (candidate) => candidate.sessionId !== sessionId,
      );
      manifest.updatedAt = this.now();
      if (manifest.sessions.length === 0) {
        await rm(this.paths.historyDir, { recursive: true, force: true });
      } else {
        await this.writeManifest(manifest);
      }
      return session.byteCount;
    });
  }

  async deleteAllSessions(): Promise<{ deletedSessions: number; freedBytes: number }> {
    return this.withLock(async () => {
      const manifest = await this.readManifest();
      const result = {
        deletedSessions: manifest.sessions.length,
        freedBytes: manifest.sessions.reduce(
          (total, session) => total + session.byteCount,
          0,
        ),
      };
      await rm(this.paths.historyDir, { recursive: true, force: true });
      return result;
    });
  }

  async enforceLimits(): Promise<void> {
    return this.withLock(async () => {
      const settings = await this.readSettings();
      const manifest = await this.readManifest();
      await this.pruneLocked(settings, manifest, 0, null);
    });
  }

  async getStorageStats(): Promise<HistoryStorageStats> {
    const manifest = await this.readManifest();
    const historyExists = await pathExists(this.paths.historyDir);
    return {
      available: true,
      directory: historyExists ? this.paths.historyDir : null,
      usedBytes: manifest.sessions.reduce(
        (total, session) => total + session.byteCount,
        0,
      ),
      sessionCount: manifest.sessions.length,
    };
  }

  private async readSettings(): Promise<HistorySettings> {
    try {
      const content = await readFile(this.paths.settingsFile, "utf8");
      const parsed: unknown = JSON.parse(content);
      if (isHistorySettings(parsed)) return parsed;
      this.logger.warn("[history/store] Invalid settings format; using defaults");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn("[history/store] Failed to read settings; using defaults");
      }
    }
    return defaultSettings();
  }

  private validateSettings(settings: HistorySettings): void {
    if (!isPositiveInteger(settings.retentionDays)) {
      throw new RangeError("retentionDays must be a positive integer");
    }
    if (!isPositiveInteger(settings.maxBytes)) {
      throw new RangeError("maxBytes must be a positive integer");
    }
    if (!isPositiveInteger(settings.maxSessionBytes)) {
      throw new RangeError("maxSessionBytes must be a positive integer");
    }
    if (settings.maxSessionBytes > settings.maxBytes) {
      throw new RangeError("maxSessionBytes must not exceed maxBytes");
    }
    if (
      settings.consentVersion !== null &&
      !isPositiveInteger(settings.consentVersion)
    ) {
      throw new RangeError("consentVersion must be a positive integer or null");
    }
  }

  private async readManifest(): Promise<HistoryManifest> {
    try {
      const content = await readFile(this.paths.manifestFile, "utf8");
      const parsed: unknown = JSON.parse(content);
      if (isHistoryManifest(parsed)) return parsed;
      this.logger.warn("[history/store] Invalid manifest format; using empty manifest");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn("[history/store] Failed to read manifest; using empty manifest");
      }
    }
    return emptyManifest(this.now());
  }

  private async writeManifest(manifest: HistoryManifest): Promise<void> {
    await ensureDirectory(this.paths.historyDir, 0o700);
    await writeAtomic(
      this.paths.manifestFile,
      JSON.stringify(manifest, null, 2),
      0o600,
    );
  }

  private findSession(
    manifest: HistoryManifest,
    sessionId: HistorySessionId,
  ): HistorySession | undefined {
    return manifest.sessions.find((session) => session.sessionId === sessionId);
  }

  private resolveSessionFile(storageFile: string): string {
    if (!isValidSessionStorageFile(storageFile)) {
      throw new HistorySessionError(
        "invalid_session_file",
        "History manifest contains an invalid session file",
      );
    }

    const candidate = path.resolve(this.paths.historyDir, storageFile);
    const sessionsRoot = `${path.resolve(this.paths.sessionsDir)}${path.sep}`;
    if (!candidate.startsWith(sessionsRoot)) {
      throw new HistorySessionError(
        "invalid_session_file",
        "History manifest points outside the sessions directory",
      );
    }
    return candidate;
  }

  private async pruneLocked(
    settings: HistorySettings,
    manifest: HistoryManifest,
    additionalBytes: number,
    protectedSessionId: HistorySessionId | null,
  ): Promise<void> {
    const cutoff = this.now() - settings.retentionDays * DAY_IN_MS;
    const candidates = manifest.sessions
      .filter(
        (session) =>
          session.status !== "active" &&
          session.sessionId !== protectedSessionId,
      )
      .sort((left, right) => {
        const leftTime = left.endedAt ?? left.startedAt;
        const rightTime = right.endedAt ?? right.startedAt;
        return leftTime - rightTime;
      });

    const expired = candidates.filter(
      (session) => (session.endedAt ?? session.startedAt) < cutoff,
    );
    for (const session of expired) {
      await this.removeSessionFromManifest(manifest, session);
    }

    let totalBytes = manifest.sessions.reduce(
      (total, session) => total + session.byteCount,
      0,
    );
    for (const session of candidates) {
      if (totalBytes + additionalBytes <= settings.maxBytes) break;
      if (!manifest.sessions.some((item) => item.sessionId === session.sessionId)) {
        continue;
      }
      await this.removeSessionFromManifest(manifest, session);
      totalBytes -= session.byteCount;
    }

    if (totalBytes + additionalBytes > settings.maxBytes) {
      throw new HistoryStorageLimitError(
        "History storage reached the total storage limit",
      );
    }

    manifest.updatedAt = this.now();
    await this.writeManifest(manifest);
  }

  private async removeSessionFromManifest(
    manifest: HistoryManifest,
    session: HistorySession,
  ): Promise<void> {
    await rm(this.resolveSessionFile(session.storageFile), {
      force: true,
    });
    manifest.sessions = manifest.sessions.filter(
      (candidate) => candidate.sessionId !== session.sessionId,
    );
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operation;
    let release!: () => void;
    this.operation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
