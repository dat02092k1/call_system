import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
