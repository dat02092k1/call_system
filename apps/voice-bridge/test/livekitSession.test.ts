import { describe, expect, it, vi } from "vitest";
import type { VoiceBridgeConfig } from "../src/config.js";
import {
  LiveKitCallSession,
  type RtcCallAdapter,
  type RtcConnectInput,
} from "../src/livekitSession.js";
import type { MediaStartEvent } from "../src/protocol.js";

const config: VoiceBridgeConfig = {
  livekitUrl: "ws://livekit:7880",
  livekitApiKey: "devkey",
  livekitApiSecret: "secret",
  port: 8091,
  mediaStartTimeoutMs: 5_000,
  agentStartTimeoutMs: 20_000,
  maxAudioBufferMs: 40,
};

const start: MediaStartEvent = {
  event: "MEDIA_START",
  connectionId: "connection-1",
  channelId: "Mock.Channel/1",
  format: "slin16",
  optimalFrameSize: 640,
  ptime: 20,
  channelVariables: {
    CALLER_NUMBER: "0900000001",
    CALLER_NAME: "Nguyen Van A",
  },
};

class FakeRtcAdapter implements RtcCallAdapter {
  connectInputs: RtcConnectInput[] = [];
  published: Int16Array[] = [];
  disconnectCount = 0;
  private agentFrameHandler: (samples: Int16Array) => void = () => undefined;
  private disconnectedHandler: () => void = () => undefined;

  async connect(input: RtcConnectInput) {
    this.connectInputs.push(input);
  }

  async publishCallerFrame(samples: Int16Array) {
    this.published.push(samples.slice());
  }

  onAgentFrame(handler: (samples: Int16Array) => void) {
    this.agentFrameHandler = handler;
  }

  onDisconnected(handler: () => void) {
    this.disconnectedHandler = handler;
  }

  emitAgentFrame(samples: Int16Array) {
    this.agentFrameHandler(samples);
  }

  emitDisconnected() {
    this.disconnectedHandler();
  }

  async disconnect() {
    this.disconnectCount += 1;
  }
}

async function eventually(assertion: () => void) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  assertion();
}

describe("LiveKitCallSession", () => {
  it("joins a deterministic room with telephony metadata", async () => {
    const rtc = new FakeRtcAdapter();
    const session = new LiveKitCallSession({
      start,
      config,
      rtc,
      sendAsteriskAudio: vi.fn(),
    });

    await session.start();

    expect(rtc.connectInputs).toEqual([
      {
        livekitUrl: "ws://livekit:7880",
        apiKey: "devkey",
        apiSecret: "secret",
        roomName: "asterisk-mock-channel-1",
        participantIdentity: "caller-mock-channel-1",
        participantName: "Nguyen Van A",
        attributes: {
          "telephony.provider": "asterisk",
          "telephony.callId": "Mock.Channel/1",
          "telephony.phoneNumber": "0900000001",
        },
      },
    ]);

    await session.close("test-complete");
  });

  it("publishes caller PCM frames sequentially", async () => {
    const rtc = new FakeRtcAdapter();
    const session = new LiveKitCallSession({
      start,
      config,
      rtc,
      sendAsteriskAudio: vi.fn(),
    });
    await session.start();

    session.pushCallerAudio(new Uint8Array([0x01, 0x00, 0xff, 0xff]));
    session.pushCallerAudio(new Uint8Array([0x02, 0x00]));

    await eventually(() => {
      expect(rtc.published.map((frame) => Array.from(frame))).toEqual([
        [1, -1],
        [2],
      ]);
    });
    await session.close("test-complete");
  });

  it("pauses Asterisk output during XOFF and resumes with PCM16 bytes", async () => {
    const rtc = new FakeRtcAdapter();
    const sent: number[][] = [];
    const session = new LiveKitCallSession({
      start,
      config,
      rtc,
      sendAsteriskAudio: (bytes) => sent.push(Array.from(bytes)),
    });
    await session.start();

    session.setAsteriskWritable(false);
    rtc.emitAgentFrame(new Int16Array([-32768, 32767]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([]);

    session.setAsteriskWritable(true);
    await eventually(() => {
      expect(sent).toEqual([[0x00, 0x80, 0xff, 0x7f]]);
    });
    await session.close("test-complete");
  });

  it("closes the RTC adapter once when either side disconnects", async () => {
    const rtc = new FakeRtcAdapter();
    const onClosed = vi.fn();
    const session = new LiveKitCallSession({
      start,
      config,
      rtc,
      sendAsteriskAudio: vi.fn(),
      onClosed,
    });
    await session.start();

    rtc.emitDisconnected();
    await eventually(() => expect(rtc.disconnectCount).toBe(1));
    await session.close("duplicate-close");

    expect(rtc.disconnectCount).toBe(1);
    expect(onClosed).toHaveBeenCalledOnce();
  });
});
