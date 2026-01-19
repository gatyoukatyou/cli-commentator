/**
 * File tail input source for external log monitoring.
 *
 * Uses `tail -f` to follow a log file and emit data events.
 * This enables live commentary for logs from external processes
 * that can't be wrapped with PTY.
 *
 * @see Issue #40
 */
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";

export interface FileTailOptions {
  /** Path to the file to tail */
  filePath: string;
  /** Number of lines to read from the end on start (default: 10) */
  tailLines?: number;
  /** Encoding for reading the file (default: utf-8) */
  encoding?: BufferEncoding;
}

export interface FileTailEvents {
  data: (chunk: string) => void;
  error: (error: Error) => void;
  exit: (code: number | null) => void;
}

/**
 * File tail input source using `tail -f`.
 *
 * Emits:
 * - 'data': when new content is appended to the file
 * - 'error': on file access or process errors
 * - 'exit': when the tail process exits
 */
export class FileTail extends EventEmitter {
  private process: ChildProcess | null = null;
  private readonly options: Required<FileTailOptions>;

  constructor(options: FileTailOptions) {
    super();
    this.options = {
      filePath: options.filePath,
      tailLines: options.tailLines ?? 10,
      encoding: options.encoding ?? "utf-8",
    };
  }

  /**
   * Start tailing the file.
   * @throws Error if the file doesn't exist or tail fails to start
   */
  start(): void {
    const { filePath, tailLines, encoding } = this.options;

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Spawn tail -f process
    // -n: number of lines from the end
    // -f: follow the file as it grows
    this.process = spawn("tail", ["-n", String(tailLines), "-f", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Handle stdout (file content)
    this.process.stdout?.setEncoding(encoding);
    this.process.stdout?.on("data", (chunk: string) => {
      this.emit("data", chunk);
    });

    // Handle stderr (errors)
    this.process.stderr?.setEncoding(encoding);
    this.process.stderr?.on("data", (chunk: string) => {
      this.emit("error", new Error(`tail stderr: ${chunk}`));
    });

    // Handle process exit
    this.process.on("exit", (code) => {
      this.emit("exit", code);
      this.process = null;
    });

    // Handle spawn errors
    this.process.on("error", (err) => {
      this.emit("error", err);
    });
  }

  /**
   * Stop tailing the file.
   */
  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

  /**
   * Check if the tail process is running.
   */
  get isRunning(): boolean {
    return this.process !== null;
  }

  // Type-safe event emitter overrides
  override on<K extends keyof FileTailEvents>(
    event: K,
    listener: FileTailEvents[K]
  ): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof FileTailEvents>(
    event: K,
    ...args: Parameters<FileTailEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Create a file tail input source.
 *
 * @example
 * ```typescript
 * const tail = createFileTail({ filePath: "/var/log/app.log" });
 * tail.on("data", (chunk) => console.log(chunk));
 * tail.on("error", (err) => console.error(err));
 * tail.start();
 * ```
 */
export function createFileTail(options: FileTailOptions): FileTail {
  return new FileTail(options);
}
