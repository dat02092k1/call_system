import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const validEnvironment = {
  LIVEKIT_URL: "ws://livekit:7880",
  LIVEKIT_API_KEY: "devkey",
  LIVEKIT_API_SECRET: "secret",
  GOOGLE_API_KEY: "google-secret-value",
};

describe("loadConfig", () => {
  it("loads the fixed Gemini voice configuration", () => {
    expect(loadConfig(validEnvironment)).toEqual({
      livekitUrl: "ws://livekit:7880",
      livekitApiKey: "devkey",
      livekitApiSecret: "secret",
      googleApiKey: "google-secret-value",
      callOrchestratorUrl: "http://call-orchestrator:3002",
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      voice: "Puck",
    });
  });

  it("names a missing variable without leaking configured secrets", () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        GOOGLE_API_KEY: " ",
      }),
    ).toThrow("GOOGLE_API_KEY is required");

    try {
      loadConfig({ ...validEnvironment, GOOGLE_API_KEY: "" });
    } catch (error) {
      expect(String(error)).not.toContain("google-secret-value");
      expect(String(error)).not.toContain("secret");
    }
  });
});
