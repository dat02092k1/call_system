import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { VoiceBridgeConfig } from "../src/config.js";
import {
  createVoiceBridgeServer,
  type BridgeCallSession,
  type VoiceBridgeServer,
} from "../src/server.js";

const baseConfig: VoiceBridgeConfig = {
  livekitUrl: "ws://livekit:7880",
  livekitApiKey: "devkey",
  livekitApiSecret: "secret",
  port: 8091,
  mediaStartTimeoutMs: 50,
  agentStartTimeoutMs: 20_000,
  maxAudioBufferMs: 500,
};

function mediaStart() {
  return JSON.stringify({
    event: "MEDIA_START",
    connection_id: "connection-1",
    channel_id: "channel-1",
    format: "slin16",
    optimal_frame_size: 640,
    ptime: 20,
    channel_variables: { CALLER_NUMBER: "0900000001" },
  });
}

function fakeSession(): BridgeCallSession {
  return {
    roomName: "asterisk-channel-1",
    start: vi.fn().mockResolvedValue(undefined),
    pushCallerAudio: vi.fn().mockReturnValue(true),
    setAsteriskWritable: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

async function eventually(assertion: () => void) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  assertion();
}

describe("Voice Bridge server", () => {
  const servers: VoiceBridgeServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function startServer(
    createSession: () => BridgeCallSession = fakeSession,
    config = baseConfig,
  ) {
    const server = createVoiceBridgeServer({ config, createSession });
    servers.push(server);
    const address = await server.listen(0);
    return { server, address };
  }

  async function openClient(port: number) {
    const client = new WebSocket(`ws://127.0.0.1:${port}/media`);
    await once(client, "open");
    return client;
  }

  it("reports health", async () => {
    const { address } = await startServer();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("closes a media socket that does not send MEDIA_START", async () => {
    const { address } = await startServer(fakeSession, {
      ...baseConfig,
      mediaStartTimeoutMs: 20,
    });
    const client = await openClient(address.port);

    const [code] = (await once(client, "close")) as [number, Buffer];
    expect(code).toBe(1008);
  });

  it("starts one session and forwards binary media and flow control", async () => {
    const session = fakeSession();
    const createSession = vi.fn(() => session);
    const { address } = await startServer(createSession);
    const client = await openClient(address.port);

    client.send(mediaStart());
    await eventually(() => expect(session.start).toHaveBeenCalledOnce());
    client.send(Buffer.from([0x01, 0x00]), { binary: true });
    client.send(JSON.stringify({ event: "MEDIA_XOFF" }));
    client.send(JSON.stringify({ event: "MEDIA_XON" }));

    await eventually(() => {
      expect(session.pushCallerAudio).toHaveBeenCalledOnce();
      expect(Array.from(vi.mocked(session.pushCallerAudio).mock.calls[0][0])).toEqual([
        0x01,
        0x00,
      ]);
      expect(session.setAsteriskWritable).toHaveBeenNthCalledWith(1, false);
      expect(session.setAsteriskWritable).toHaveBeenNthCalledWith(2, true);
    });

    client.close();
    await eventually(() => expect(session.close).toHaveBeenCalledOnce());
  });

  it("rejects binary before start and duplicate MEDIA_START", async () => {
    const { address } = await startServer();
    const earlyBinary = await openClient(address.port);
    earlyBinary.send(Buffer.from([0x00, 0x00]), { binary: true });
    const [earlyCode] = (await once(earlyBinary, "close")) as [number, Buffer];
    expect(earlyCode).toBe(1002);

    const duplicate = await openClient(address.port);
    duplicate.send(mediaStart());
    duplicate.send(mediaStart());
    const [duplicateCode] = (await once(duplicate, "close")) as [number, Buffer];
    expect(duplicateCode).toBe(1002);
  });
});
