import { describe, expect, it } from "vitest";
import { createSessionOptions } from "../src/session.js";

describe("createSessionOptions", () => {
  it("builds the approved Gemini native-audio options", () => {
    expect(
      createSessionOptions({
        livekitUrl: "ws://livekit:7880",
        livekitApiKey: "devkey",
        livekitApiSecret: "secret",
        googleApiKey: "google-key",
        callOrchestratorUrl: "http://call-orchestrator:3002",
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        voice: "Puck",
      }),
    ).toEqual({
      apiKey: "google-key",
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      voice: "Puck",
      temperature: 0.7,
    });
  });
});
