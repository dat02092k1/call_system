import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  normalizeLiveKitId,
  parseMediaControl,
  pcmBytesToSamples,
} from "../src/protocol.js";

describe("Asterisk media protocol", () => {
  it("parses the native JSON emitted by Asterisk chan_websocket", async () => {
    const payload = await readFile(
      new URL("./fixtures/asterisk-media-start.json", import.meta.url),
      "utf8",
    );
    expect(parseMediaControl(payload)).toEqual({
      event: "MEDIA_START",
      connectionId: "8f41dd0e-4c5a-4c43-ae2d-6f08d5b9ec31",
      channelId: "1741a49a-9d4f-4fd5-8efe-49f3785a64a2",
      format: "slin16",
      optimalFrameSize: 640,
      ptime: 20,
      channelVariables: {
        CALLER_NUMBER: "2001",
        CALLER_NAME: "Nguyen Van A",
      },
    });
  });

  it("parses a valid slin16 MEDIA_START event", () => {
    expect(
      parseMediaControl(
        JSON.stringify({
          event: "MEDIA_START",
          connection_id: "connection-1",
          channel_id: "channel-1",
          format: "slin16",
          optimal_frame_size: 640,
          ptime: 20,
          channel_variables: { CALLER_NUMBER: "0900000001" },
        }),
      ),
    ).toEqual({
      event: "MEDIA_START",
      connectionId: "connection-1",
      channelId: "channel-1",
      format: "slin16",
      optimalFrameSize: 640,
      ptime: 20,
      channelVariables: { CALLER_NUMBER: "0900000001" },
    });
  });

  it.each([
    ["MEDIA_XOFF", { event: "MEDIA_XOFF" }],
    ["MEDIA_XON", { event: "MEDIA_XON" }],
    ["DTMF_END", { event: "DTMF_END", digit: "7" }],
  ])("parses %s control events", (event, expected) => {
    expect(
      parseMediaControl(
        JSON.stringify(event === "DTMF_END" ? { event, digit: "7" } : { event }),
      ),
    ).toEqual(expected);
  });

  it("keeps unknown event names without accepting invalid starts", () => {
    expect(parseMediaControl('{"event":"STATUS"}')).toEqual({
      event: "UNKNOWN",
      name: "STATUS",
    });
    expect(() => parseMediaControl("not-json")).toThrow(/JSON/);
    expect(() =>
      parseMediaControl(
        JSON.stringify({
          event: "MEDIA_START",
          connection_id: "c",
          channel_id: "ch",
          format: "ulaw",
          optimal_frame_size: 160,
          ptime: 20,
        }),
      ),
    ).toThrow(/slin16/);
  });

  it("normalizes identifiers and rejects empty results", () => {
    expect(normalizeLiveKitId(" Mock.Channel/1 ")).toBe("mock-channel-1");
    expect(normalizeLiveKitId("A".repeat(200))).toHaveLength(96);
    expect(() => normalizeLiveKitId("///")).toThrow(/identifier/);
  });

  it("decodes little-endian PCM16 and rejects partial samples", () => {
    expect(
      Array.from(pcmBytesToSamples(new Uint8Array([0x00, 0x80, 0xff, 0x7f]))),
    ).toEqual([-32768, 32767]);
    expect(() => pcmBytesToSamples(new Uint8Array([0x01]))).toThrow(/even/);
  });
});
