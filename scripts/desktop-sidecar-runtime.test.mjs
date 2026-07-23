import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMacOSNodeRuntimePortableFromOtool,
  assertNodeRuntimePortable,
  findNonSystemMacOSDependencies,
  parseOtoolDependencies,
  smokeTestNodeRuntime,
} from "./desktop-sidecar-runtime.mjs";

const portableOtoolOutput = `/tmp/node:
\t/usr/lib/libz.1.dylib (compatibility version 1.0.0, current version 1.2.12)
\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 150.0.0, current version 4201.0.0)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1356.0.0)
`;

const homebrewOtoolOutput = `/opt/homebrew/bin/node:
\t@rpath/libnode.127.dylib (compatibility version 0.0.0, current version 0.0.0)
\t/opt/homebrew/opt/libuv/lib/libuv.1.dylib (compatibility version 1.0.0, current version 1.0.0)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1356.0.0)
`;

test("parses dependencies from otool output", () => {
  assert.deepEqual(parseOtoolDependencies(portableOtoolOutput), [
    "/usr/lib/libz.1.dylib",
    "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation",
    "/usr/lib/libSystem.B.dylib",
  ]);
});

test("classifies rpath and Homebrew libraries as non-system dependencies", () => {
  assert.deepEqual(
    findNonSystemMacOSDependencies(
      parseOtoolDependencies(homebrewOtoolOutput)
    ),
    [
      "@rpath/libnode.127.dylib",
      "/opt/homebrew/opt/libuv/lib/libuv.1.dylib",
    ]
  );
});

test("accepts a macOS Node runtime with system dependencies only", () => {
  assert.doesNotThrow(() =>
    assertMacOSNodeRuntimePortableFromOtool(
      "/tmp/node",
      portableOtoolOutput
    )
  );
});

test("rejects a Homebrew-linked macOS Node runtime with recovery guidance", () => {
  assert.throws(
    () =>
      assertMacOSNodeRuntimePortableFromOtool(
        "/opt/homebrew/bin/node",
        homebrewOtoolOutput
      ),
    (error) => {
      assert.match(error.message, /\[sidecar_node_not_portable\]/);
      assert.match(error.message, /@rpath\/libnode\.127\.dylib/);
      assert.match(error.message, /\/opt\/homebrew\/opt\/libuv/);
      assert.match(error.message, /nodejs\.org/);
      return true;
    }
  );
});

test("runs otool only on macOS", () => {
  let calls = 0;
  assertNodeRuntimePortable("/tmp/node", {
    platform: "linux",
    runOtool: () => {
      calls += 1;
      return homebrewOtoolOutput;
    },
  });
  assert.equal(calls, 0);
});

test("reports an otool inspection failure clearly", () => {
  assert.throws(
    () =>
      assertNodeRuntimePortable("/tmp/node", {
        platform: "darwin",
        runOtool: () => {
          throw new Error("otool unavailable");
        },
      }),
    /\[sidecar_node_dependency_inspection_failed\].*otool unavailable/
  );
});

test("accepts a bundled Node runtime with the expected version", () => {
  assert.doesNotThrow(() =>
    smokeTestNodeRuntime("/tmp/node", "v22.0.0", {
      runNode: () => ({
        status: 0,
        stdout: "v22.0.0\n",
        stderr: "",
      }),
    })
  );
});

test("rejects a bundled Node runtime that cannot start", () => {
  assert.throws(
    () =>
      smokeTestNodeRuntime("/tmp/node", "v22.0.0", {
        runNode: () => ({
          status: 134,
          stdout: "",
          stderr: "dyld: Library not loaded: @rpath/libnode.127.dylib",
        }),
      }),
    /\[sidecar_node_smoke_failed\].*dyld: Library not loaded/
  );
});

test("rejects an unexpected bundled Node version", () => {
  assert.throws(
    () =>
      smokeTestNodeRuntime("/tmp/node", "v22.0.0", {
        runNode: () => ({
          status: 0,
          stdout: "v20.0.0\n",
          stderr: "",
        }),
      }),
    /\[sidecar_node_smoke_failed\].*expected=v22\.0\.0.*actual=v20\.0\.0/
  );
});
