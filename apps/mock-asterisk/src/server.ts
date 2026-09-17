import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { createMediaStartEvent, parseBrowserControl } from "./protocol.js";

export type MockAsteriskConfig = {
  port: number;
  voiceBridgeUrl: string;
  startTimeoutMs: number;
};

export type MockAsteriskServer = {
  listen(port?: number): Promise<{ port: number }>;
  close(): Promise<void>;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Mock Asterisk numeric configuration must be positive");
  }
  return parsed;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): MockAsteriskConfig {
  const voiceBridgeUrl = env.VOICE_BRIDGE_URL?.trim();
  if (!voiceBridgeUrl || !/^wss?:\/\//i.test(voiceBridgeUrl)) {
    throw new Error("VOICE_BRIDGE_URL must use ws:// or wss://");
  }
  return {
    port: positiveInteger(env.PORT, 8090),
    voiceBridgeUrl,
    startTimeoutMs: positiveInteger(env.CALL_START_TIMEOUT_MS, 5_000),
  };
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function sendControl(socket: WebSocket, message: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export function createMockAsteriskServer(
  config: MockAsteriskConfig,
): MockAsteriskServer {
  const browserSockets = new Set<WebSocket>();
  const bridgeSockets = new Set<WebSocket>();
  const httpServer: HttpServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  const webSocketServer = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "/", "http://mock-asterisk").pathname;
    if (pathname !== "/call") {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (browser) => {
    browserSockets.add(browser);
    let bridge: WebSocket | undefined;
    let callStarted = false;
    let callReady = false;
    let ended = false;
    const pendingAudio: Buffer[] = [];
    const startTimer = setTimeout(() => {
      failCall("call.start timeout", 1008);
    }, config.startTimeoutMs);

    function failCall(message: string, code = 1011) {
      if (ended) return;
      ended = true;
      clearTimeout(startTimer);
      sendControl(browser, { type: "call.failed", message });
      if (browser.readyState === WebSocket.OPEN) {
        browser.close(code, message.slice(0, 120));
      }
      if (bridge?.readyState === WebSocket.OPEN) {
        bridge.close(1000, "paired call failed");
      }
    }

    function finishCall(reason: string) {
      if (ended) return;
      ended = true;
      clearTimeout(startTimer);
      sendControl(browser, { type: "call.ended", reason });
      if (browser.readyState === WebSocket.OPEN) {
        browser.close(1000, reason.slice(0, 120));
      }
      if (bridge?.readyState === WebSocket.OPEN) {
        bridge.close(1000, reason.slice(0, 120));
      }
    }

    browser.on("message", (data, isBinary) => {
      if (isBinary) {
        if (!callStarted) {
          failCall("call.start required", 1002);
          return;
        }
        const audio = rawDataToBuffer(data);
        if (callReady && bridge?.readyState === WebSocket.OPEN) {
          bridge.send(audio, { binary: true });
        } else {
          if (pendingAudio.length === 25) pendingAudio.shift();
          pendingAudio.push(audio);
        }
        return;
      }

      let control;
      try {
        control = parseBrowserControl(data.toString());
      } catch (error) {
        failCall(error instanceof Error ? error.message : "Invalid call control", 1008);
        return;
      }
      if (control.type === "call.hangup") {
        finishCall("browser-hangup");
        return;
      }
      if (callStarted) {
        failCall("Duplicate call.start", 1002);
        return;
      }

      callStarted = true;
      clearTimeout(startTimer);
      const connectionId = randomUUID();
      const channelId = `mock-${randomUUID()}`;
      bridge = new WebSocket(config.voiceBridgeUrl);
      bridgeSockets.add(bridge);

      bridge.on("open", () => {
        if (!bridge || ended) return;
        bridge.send(
          createMediaStartEvent({
            connectionId,
            channelId,
            displayName: control.displayName,
            phoneNumber: control.phoneNumber,
          }),
        );
        callReady = true;
        sendControl(browser, {
          type: "call.ready",
          callId: channelId,
        });
        for (const audio of pendingAudio.splice(0)) {
          bridge.send(audio, { binary: true });
        }
      });

      bridge.on("message", (bridgeData, bridgeIsBinary) => {
        if (
          bridgeIsBinary &&
          browser.readyState === WebSocket.OPEN
        ) {
          browser.send(rawDataToBuffer(bridgeData), { binary: true });
        }
      });

      bridge.on("close", (code, reason) => {
        if (bridge) bridgeSockets.delete(bridge);
        if (!ended) {
          if (callReady) {
            finishCall(reason.toString() || `bridge-closed-${code}`);
          } else {
            failCall(reason.toString() || "Voice Bridge unavailable");
          }
        }
      });

      bridge.on("error", (error) => {
        console.warn("[mock-asterisk] Voice Bridge websocket error", {
          channelId,
          error: error.message,
        });
      });
    });

    browser.on("close", () => {
      browserSockets.delete(browser);
      clearTimeout(startTimer);
      ended = true;
      if (bridge?.readyState === WebSocket.OPEN) {
        bridge.close(1000, "browser-disconnected");
      } else if (bridge?.readyState === WebSocket.CONNECTING) {
        bridge.terminate();
      }
    });

    browser.on("error", (error) => {
      console.warn("[mock-asterisk] browser websocket error", {
        error: error.message,
      });
    });
  });

  return {
    listen(port = config.port) {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, "0.0.0.0", () => {
          httpServer.off("error", reject);
          const address = httpServer.address();
          if (!address || typeof address === "string") {
            reject(new Error("Mock Asterisk did not bind a TCP port"));
            return;
          }
          resolve({ port: address.port });
        });
      });
    },
    async close() {
      for (const socket of browserSockets) socket.terminate();
      for (const socket of bridgeSockets) socket.terminate();
      browserSockets.clear();
      bridgeSockets.clear();
      await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const server = createMockAsteriskServer(config);
  server.listen().then(({ port }) => {
    console.info("[mock-asterisk] listening", {
      port,
      voiceBridgeUrl: config.voiceBridgeUrl,
    });
  }).catch((error) => {
    console.error("[mock-asterisk] failed to start", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
