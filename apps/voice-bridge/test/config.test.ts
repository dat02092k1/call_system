import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const required = {
  LIVEKIT_URL: "ws://livekit:7880",
  LIVEKIT_API_KEY: "devkey",
  LIVEKIT_API_SECRET: "secret",
};

describe("voice bridge config", () => {
  it("loads safe local defaults", () => {
    expect(loadConfig(required)).toEqual({
      livekitUrl: "ws://livekit:7880",
      livekitApiKey: "devkey",
      livekitApiSecret: "secret",
      port: 8091,
      mediaStartTimeoutMs: 5_000,
      agentStartTimeoutMs: 20_000,
      maxAudioBufferMs: 500,
    });
  });

  it("rejects missing credentials and invalid positive integers", () => {
    expect(() => loadConfig({})).toThrow(/LIVEKIT_URL/);
    expect(() =>
      loadConfig({ ...required, MAX_AUDIO_BUFFER_MS: "0" }),
    ).toThrow(/MAX_AUDIO_BUFFER_MS/);
  });
});
