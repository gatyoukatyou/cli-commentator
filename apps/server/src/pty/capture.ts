import fs from "node:fs";
import path from "node:path";

export type PtyCapture = {
  write: (data: string, ts?: number) => void;
  close: () => void;
};

type CaptureRecord =
  | { kind: "meta"; version: 1; startedAt: number }
  | { kind: "data"; ts: number; dataBase64: string };

export function createPtyCapture(filePath?: string): PtyCapture | null {
  const resolved = filePath?.trim();
  if (!resolved) return null;

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const fd = fs.openSync(resolved, "a", 0o600);
  fs.chmodSync(resolved, 0o600);
  let closed = false;

  const append = (record: CaptureRecord): void => {
    if (closed) return;
    fs.writeSync(fd, `${JSON.stringify(record)}\n`, undefined, "utf8");
  };

  append({ kind: "meta", version: 1, startedAt: Date.now() });

  return {
    write(data, ts = Date.now()) {
      append({
        kind: "data",
        ts,
        dataBase64: Buffer.from(data, "utf8").toString("base64"),
      });
    },
    close() {
      if (closed) return;
      closed = true;
      fs.closeSync(fd);
    },
  };
}
