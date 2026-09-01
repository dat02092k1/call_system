import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfile = await readFile(
  new URL("../Dockerfile", import.meta.url),
  "utf8",
);

test("excludes staged runtime state before copying into Debian", () => {
  const cleanup = dockerfile.indexOf("rm -rf /opt/asterisk-root/var/run");
  const rootCopy = dockerfile.indexOf(
    "COPY --from=build /opt/asterisk-root/ /",
  );
  assert.ok(cleanup >= 0 && cleanup < rootCopy);
});
