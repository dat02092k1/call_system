import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  createMockAsteriskServer,
  type MockAsteriskServer,
} from "../src/server.js";

function bytes(data: RawData): number[] {
  if (Buffer.isBuffer(data)) {
    return Array.from(data);
  }
  if (Array.isArray(data)) {
    return Array.from(Buffer.concat(data));
  }
  return Array.from(new Uint8Array(data));
}

describe("Mock Asterisk server", () => {
  const mockServers: MockAsteriskServer[] = [];
  const bridgeServers: WebSocketServer[] = [];

  afterEach(async () => {
    await Promise.all(mockServers.splice(0).map((server) => server.close()));
    await Promise.all(
      bridgeServers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            for (const client of server.clients) client.terminate();
            server.close(() => resolve());
          }),
      ),
    );
  });

  async function setup() {
    const bridgeServer = new WebSocketServer({ port: 0 });
    bridgeServers.push(bridgeServer);
    await once(bridgeServer, "listening");
    const bridgeAddress = bridgeServer.address();
    if (!bridgeAddress || typeof bridgeAddress === "string") {
      throw new Error("Expected TCP address");
    }

    const mockServer = createMockAsteriskServer({
      port: 8090,
      voiceBridgeUrl: `ws://127.0.0.1:${bridgeAddress.port}/media`,
      startTimeoutMs: 100,
    });
    mockServers.push(mockServer);
    const mockAddress = await mockServer.listen(0);
    const browser = new WebSocket(`ws://127.0.0.1:${mockAddress.port}/call`);
    await once(browser, "open");
    return { bridgeServer, browser, mockAddress };
  }

  it("reports health", async () => {
    const { mockAddress } = await setup();
    const response = await fetch(`http://127.0.0.1:${mockAddress.port}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("opens one bridge call and forwards binary audio both ways", async () => {
    const { bridgeServer, browser } = await setup();
    let bridgeSocket!: WebSocket;
    const bridgeStart = new Promise<string>((resolve) => {
      bridgeServer.once("connection", (socket) => {
        bridgeSocket = socket;
        socket.once("message", (data) => resolve(data.toString()));
      });
    });
    const browserReady = new Promise<Record<string, unknown>>((resolve) => {
      browser.once("message", (data) => resolve(JSON.parse(data.toString())));
    });

    browser.send(
      JSON.stringify({
        type: "call.start",
        displayName: "Nguyen Van A",
        phoneNumber: "0900000001",
      }),
    );

    expect(JSON.parse(await bridgeStart)).toMatchObject({
      event: "MEDIA_START",
      format: "slin16",
      channel_variables: { CALLER_NUMBER: "0900000001" },
    });
    await expect(browserReady).resolves.toMatchObject({ type: "call.ready" });

    const bridgeAudio = new Promise<number[]>((resolve) => {
      bridgeSocket.once("message", (data, isBinary) => {
        expect(isBinary).toBe(true);
        resolve(bytes(data));
      });
    });
    browser.send(Buffer.from([1, 2, 3, 4]), { binary: true });
    await expect(bridgeAudio).resolves.toEqual([1, 2, 3, 4]);

    const browserAudio = new Promise<number[]>((resolve) => {
      browser.once("message", (data, isBinary) => {
        expect(isBinary).toBe(true);
        resolve(bytes(data));
      });
    });
    bridgeSocket.send(Buffer.from([5, 6]), { binary: true });
    await expect(browserAudio).resolves.toEqual([5, 6]);
  });

  it("rejects invalid browser control messages", async () => {
    const { browser } = await setup();
    const failure = new Promise<Record<string, unknown>>((resolve) => {
      browser.once("message", (data) => resolve(JSON.parse(data.toString())));
    });
    browser.send("not-json");

    await expect(failure).resolves.toMatchObject({
      type: "call.failed",
    });
    const [code] = (await once(browser, "close")) as [number, Buffer];
    expect(code).toBe(1008);
  });
});
