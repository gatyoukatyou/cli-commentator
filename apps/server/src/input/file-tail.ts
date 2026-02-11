/**
 * File tail input source for external log monitoring.
 *
 * Watches a file and emits appended content as `data` events.
 * This enables live commentary for logs from external processes
 * that can't be wrapped with PTY.
 *
 * @see Issue #40
 */
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
 * File tail input source using fs watch.
 *
 * Emits:
 * - 'data': when new content is appended to the file
 * - 'error': on file access or watch errors
 * - 'exit': when tailing is stopped
 */
export class FileTail extends EventEmitter {
  private watcher: fs.FSWatcher | null = null;
  private readonly options: Required<FileTailOptions>;
  private readPosition = 0;
  private isReading = false;

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
   * @throws Error if the file doesn't exist or watcher fails to start
   */
  start(): void {
    const { filePath } = this.options;

    if (this.watcher) return;

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    try {
      this.emitInitialContent();
      this.watcher = fs.watch(filePath, (eventType) => {
        if (eventType === "change") {
          this.readNewContent();
        }
      });

      this.watcher.on("error", (err) => {
        this.emit("error", err);
      });
    } catch (err) {
      this.emit("error", err as Error);
      throw err;
    }
  }

  /**
   * Stop tailing the file.
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.emit("exit", 0);
    }
  }

  /**
   * Check if watcher is running.
   */
  get isRunning(): boolean {
    return this.watcher !== null;
  }

  private emitInitialContent(): void {
    const { filePath, tailLines, encoding } = this.options;
    const content = fs.readFileSync(filePath, { encoding });

    const lines = content.split(/\r?\n/);
    const trailingNewline = content.endsWith("\n") || content.endsWith("\r\n");
    if (trailingNewline && lines.length > 0) {
      lines.pop();
    }

    if (tailLines > 0 && lines.length > 0) {
      const lastLines = lines.slice(-tailLines);
      const chunk = `${lastLines.join("\n")}\n`;
      this.emit("data", chunk);
    }

    this.readPosition = Buffer.byteLength(content, encoding);
  }

  private readNewContent(): void {
    if (this.isReading) return;

    const { filePath, encoding } = this.options;
    this.isReading = true;

    fs.stat(filePath, (statErr, stats) => {
      if (statErr) {
        this.isReading = false;
        this.emit("error", statErr);
        return;
      }

      // Handle truncation/rotation by resetting position
      if (stats.size < this.readPosition) {
        this.readPosition = 0;
      }

      const start = this.readPosition;
      const end = stats.size - 1;

      if (end < start) {
        this.isReading = false;
        return;
      }

      let chunk = "";
      const stream = fs.createReadStream(filePath, {
        start,
        end,
        encoding,
      });

      stream.on("data", (data: string) => {
        chunk += data;
      });

      stream.on("error", (err) => {
        this.isReading = false;
        this.emit("error", err);
      });

      stream.on("end", () => {
        this.readPosition = stats.size;
        this.isReading = false;
        if (chunk.length > 0) {
          this.emit("data", chunk);
        }
      });
    });
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
