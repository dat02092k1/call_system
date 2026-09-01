import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const dockerfile = await readFile(
  new URL("../Dockerfile", import.meta.url),
  "utf8",
);

const installCommand = "    && make DESTDIR=/opt/asterisk-root install \\";
const cleanupCommand = "    && rm -rf /opt/asterisk-root/var/run";
const runtimeCopyCommand = "COPY --from=build /opt/asterisk-root/ /";

function exactLineIndex(source, command) {
  const indexes = source
    .split(/\r?\n/)
    .flatMap((line, index) => (line === command ? [index] : []));

  assert.equal(indexes.length, 1, `expected exactly one command line: ${command}`);
  return indexes[0];
}

function assertEffectiveRuntimeCopyOrdering(source) {
  const install = exactLineIndex(source, installCommand);
  const cleanup = exactLineIndex(source, cleanupCommand);
  const runtimeCopy = exactLineIndex(source, runtimeCopyCommand);

  assert.ok(
    install < cleanup && cleanup < runtimeCopy,
    "expected staged install before exact /var/run cleanup before runtime root copy",
  );
}

test("removes staged runtime state after install and before Debian copy", () => {
  assertEffectiveRuntimeCopyOrdering(dockerfile);
});

test("rejects cleanup before staged install", () => {
  const cleanupBeforeInstall = dockerfile.replace(
    `${installCommand}\n${cleanupCommand}`,
    `${cleanupCommand}\n${installCommand}`,
  );
  assert.notEqual(cleanupBeforeInstall, dockerfile);

  const oldCleanup = cleanupBeforeInstall.indexOf(
    "rm -rf /opt/asterisk-root/var/run",
  );
  const oldRuntimeCopy = cleanupBeforeInstall.indexOf(runtimeCopyCommand);
  assert.ok(oldCleanup >= 0 && oldCleanup < oldRuntimeCopy);

  assert.throws(
    () => assertEffectiveRuntimeCopyOrdering(cleanupBeforeInstall),
    /expected staged install before exact \/var\/run cleanup before runtime root copy/,
  );
});

test(
  "healthcheck queries the WebSocket transport and crypto modules",
  { skip: process.platform !== "linux" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "asterisk-healthcheck-"));
    const fakeAsterisk = join(directory, "asterisk");
    const calls = join(directory, "calls.log");
    const healthcheck = new URL("../scripts/healthcheck.sh", import.meta.url);
    await writeFile(
      fakeAsterisk,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$ASTERISK_CALL_LOG"
case "$*" in
  *"module show like"*) printf '%s\\n' "module Running" ;;
  *"http show status"*) printf '%s\\n' "Enabled and Bound" ;;
esac
`,
      { mode: 0o755 },
    );

    try {
      await execFileAsync("sh", [healthcheck.pathname], {
        env: {
          ...process.env,
          ASTERISK_CALL_LOG: calls,
          PATH: `${directory}:${process.env.PATH}`,
        },
      });
      const invocations = await readFile(calls, "utf8");
      assert.match(
        invocations,
        /-rx module show like res_pjsip_transport_websocket\.so/,
      );
      assert.match(invocations, /-rx module show like res_crypto\.so/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
