import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compose = await readFile(
  new URL("../../../compose.yaml", import.meta.url),
  "utf8",
);

test("adds Asterisk without removing existing gateways", () => {
  for (const service of ["asterisk:", "sip:", "mock-asterisk:", "voice-bridge:"]) {
    assert.match(compose, new RegExp(`^  ${service}`, "m"));
  }
  assert.match(compose, /asterisk:[\s\S]*?network_mode: host/);
  assert.match(compose, /asterisk:[\s\S]*?apps\/asterisk/);
});

test("passes all browser SIP settings", () => {
  for (const name of [
    "VITE_ASTERISK_WS_URL",
    "VITE_ASTERISK_DOMAIN",
    "VITE_ASTERISK_EXTENSION",
    "VITE_ASTERISK_PASSWORD",
    "VITE_ASTERISK_DESTINATION",
  ]) {
    assert.match(compose, new RegExp(name));
  }
});
