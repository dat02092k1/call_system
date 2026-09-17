import { describe, expect, it, vi } from "vitest";
import {
  AsteriskCallClient,
  type AsteriskAudioIo,
  type AsteriskSocket,
} from "../asterisk/AsteriskCallClient";

class FakeSocket extends EventTarget implements AsteriskSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  binaryType = "blob";
  readyState = FakeSocket.CONNECTING;
  sent: Array<string | ArrayBufferLike | ArrayBufferView> = [];
  closeCount = 0;

  send(data: string | ArrayBufferLike | ArrayBufferView) {
    this.sent.push(data);
  }

  close() {
    this.closeCount += 1;
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  message(data: string | ArrayBuffer) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function fakeAudioIo(): AsteriskAudioIo & {
  emit: (samples: Float32Array) => void;
  played: Uint8Array[];
  stop: ReturnType<typeof vi.fn>;
} {
  let capture: (samples: Float32Array) => void = () => undefined;
  const played: Uint8Array[] = [];
  const stop = vi.fn().mockResolvedValue(undefined);
  return {
    start: vi.fn(async (handler) => {
      capture = handler;
      return 48_000;
    }),
    play: vi.fn((bytes) => played.push(bytes.slice())),
    stop,
    emit: (samples) => capture(samples),
    played,
  };
}

describe("AsteriskCallClient", () => {
  it("handshakes, streams PCM both ways, and cleans up once", async () => {
    const socket = new FakeSocket();
    const audio = fakeAudioIo();
    const states: string[] = [];
    const client = new AsteriskCallClient({
      url: "ws://localhost:8090/call",
      onStateChange: (state) => states.push(state.status),
      createSocket: () => socket,
      createAudioIo: () => audio,
    });

    client.start({
      displayName: "Nguyen Van A",
      phoneNumber: "0900000001",
    });
    expect(states).toEqual(["connecting"]);

    socket.open();
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      type: "call.start",
      displayName: "Nguyen Van A",
      phoneNumber: "0900000001",
    });

    socket.message(JSON.stringify({ type: "call.ready", callId: "mock-1" }));
    await vi.waitFor(() => expect(states.at(-1)).toBe("active"));

    audio.emit(new Float32Array([0, 1, -1]));
    const microphoneMessage = socket.sent[1] as ArrayBuffer;
    expect(Array.from(new Int16Array(microphoneMessage))).toEqual([0]);

    socket.message(new Uint8Array([0x01, 0x00]).buffer);
    expect(audio.played.map((value) => Array.from(value))).toEqual([[1, 0]]);

    await client.hangup();
    await client.hangup();
    expect(socket.closeCount).toBe(1);
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(states.at(-1)).toBe("ended");
  });

  it("surfaces a call.failed message and releases audio", async () => {
    const socket = new FakeSocket();
    const audio = fakeAudioIo();
    const states: Array<{ status: string; message?: string }> = [];
    const client = new AsteriskCallClient({
      url: "ws://localhost:8090/call",
      onStateChange: (state) => states.push(state),
      createSocket: () => socket,
      createAudioIo: () => audio,
    });
    client.start({ displayName: "A", phoneNumber: "0900000001" });
    socket.open();
    socket.message(JSON.stringify({ type: "call.failed", message: "offline" }));

    await vi.waitFor(() => {
      expect(states.at(-1)).toEqual({ status: "failed", message: "offline" });
    });
    expect(audio.stop).toHaveBeenCalledOnce();
  });
});
