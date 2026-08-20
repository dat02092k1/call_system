import { describe, expect, it } from "vitest";
import {
  createMediaStartEvent,
  parseBrowserControl,
} from "../src/protocol.js";

describe("Mock Asterisk protocol", () => {
  it("validates browser call.start messages", () => {
    expect(
      parseBrowserControl(
        JSON.stringify({
          type: "call.start",
          displayName: " Nguyen Van A ",
          phoneNumber: "0900000001",
        }),
      ),
    ).toEqual({
      type: "call.start",
      displayName: "Nguyen Van A",
      phoneNumber: "0900000001",
    });
    expect(() => parseBrowserControl("not-json")).toThrow(/JSON/);
    expect(() =>
      parseBrowserControl('{"type":"call.start","displayName":""}'),
    ).toThrow(/displayName/);
  });

  it("creates an Asterisk-compatible slin16 MEDIA_START event", () => {
    expect(
      JSON.parse(
        createMediaStartEvent({
          connectionId: "connection-1",
          channelId: "channel-1",
          displayName: "Nguyen Van A",
          phoneNumber: "0900000001",
        }),
      ),
    ).toEqual({
      event: "MEDIA_START",
      connection_id: "connection-1",
      channel_id: "channel-1",
      format: "slin16",
      optimal_frame_size: 640,
      ptime: 20,
      channel_variables: {
        CALLER_NAME: "Nguyen Van A",
        CALLER_NUMBER: "0900000001",
      },
    });
  });
});
