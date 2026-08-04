import { describe, it, expect } from "vitest";
import { isNodePtyAvailable } from "../pty/manager.js";

const canRunPtyTests = isNodePtyAvailable();

describe.skipIf(!canRunPtyTests)("PTY smoke test", () => {
  it("spawns a simple command and receives output", async () => {
    const { createPTYManager } = await import("../pty/manager.js");
    const manager = createPTYManager();

    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "cmd.exe" : "bash";
    const args = isWindows ? ["/c", "echo", "hello-pty-smoke"] : ["-lc", "echo hello-pty-smoke"];

    const ptyProcess = manager.spawn({
      cmd,
      args,
      cwd: process.cwd(),
    });

    const output = await new Promise<string>((resolve, reject) => {
      let data = "";
      const timeout = setTimeout(() => {
        manager.kill();
        reject(new Error("PTY timeout after 5s"));
      }, 5000);

      ptyProcess.onData((chunk) => {
        data += chunk;
        if (data.includes("hello-pty-smoke")) {
          clearTimeout(timeout);
          manager.kill();
          resolve(data);
        }
      });

      ptyProcess.onExit(() => {
        clearTimeout(timeout);
        resolve(data);
      });
    });

    expect(output).toContain("hello-pty-smoke");
  });

  it.skipIf(process.platform === "win32")("updates the child terminal dimensions after resize", async () => {
    const { createPTYManager } = await import("../pty/manager.js");
    const manager = createPTYManager();
    const ptyProcess = manager.spawn({
      cmd: "bash",
      args: ["--noprofile", "--norc"],
      cwd: process.cwd(),
    });

    const output = await new Promise<string>((resolve, reject) => {
      let data = "";
      const timeout = setTimeout(() => {
        manager.kill();
        reject(new Error("PTY resize timeout after 5s"));
      }, 5000);

      ptyProcess.onData((chunk) => {
        data += chunk;
        if (/32\s+96/.test(data)) {
          clearTimeout(timeout);
          manager.kill();
          resolve(data);
        }
      });

      manager.resize(96, 32);
      manager.write("stty size\r");
    });

    expect(output).toMatch(/32\s+96/);
  });
});
