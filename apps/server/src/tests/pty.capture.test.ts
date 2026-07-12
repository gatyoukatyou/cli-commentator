import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPtyCapture } from "../pty/capture.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("createPtyCapture", () => {
  it("stays disabled without an explicit path", () => {
    expect(createPtyCapture()).toBeNull();
    expect(createPtyCapture("   ")).toBeNull();
  });

  it("records exact PTY chunks with timestamps as base64 JSONL", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-commentator-pty-capture-"));
    tempDirs.push(dir);
    const capturePath = path.join(dir, "nested", "session.pty-capture.jsonl");
    const capture = createPtyCapture(capturePath);

    capture?.write("\u001b[2J許可しますか？\r\n", 1234);
    capture?.close();

    const records = fs
      .readFileSync(capturePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(records[0]).toMatchObject({ kind: "meta", version: 1 });
    expect(records[1]).toEqual({
      kind: "data",
      ts: 1234,
      dataBase64: Buffer.from("\u001b[2J許可しますか？\r\n", "utf8").toString("base64"),
    });
    expect(fs.statSync(capturePath).mode & 0o777).toBe(0o600);
  });
});
