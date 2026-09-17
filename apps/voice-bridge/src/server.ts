import { createServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { loadConfig, type VoiceBridgeConfig } from "./config.js";
import { createLiveKitCallSession } from "./livekitSession.js";
import { parseMediaControl, type MediaStartEvent } from "./protocol.js";

export type BridgeCallSession = {
  roomName: string;
  start(): Promise<void>;
  pushCallerAudio(bytes: Uint8Array): boolean;
  setAsteriskWritable(writable: boolean): void;
  close(reason: string): Promise<void>;
};

export type CallSessionFactoryInput = {
  start: MediaStartEvent;
  config: VoiceBridgeConfig;
  sendAsteriskAudio: (bytes: Uint8Array) => void;
  onClosed: (reason: string) => void;
};

type VoiceBridgeServerOptions = {
  config: VoiceBridgeConfig;
  createSession?: (input: CallSessionFactoryInput) => BridgeCallSession;
};

export type VoiceBridgeServer = {
  listen(port?: number): Promise<{ port: number }>;
  close(): Promise<void>;
};

function rawDataToBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  }
  if (Array.isArray(data)) {
    const combined = Buffer.concat(data);
    return new Uint8Array(
      combined.buffer,
      combined.byteOffset,
      combined.byteLength,
    ).slice();
  }
  return new Uint8Array(data).slice();
}

function closeSocket(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(code, reason.slice(0, 120));
  }
}

export function createVoiceBridgeServer(
  options: VoiceBridgeServerOptions,
): VoiceBridgeServer {
  const createSession = options.createSession ?? createLiveKitCallSession;
  const sockets = new Set<WebSocket>();
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
    const pathname = new URL(request.url || "/", "http://voice-bridge").pathname;
    if (pathname !== "/media") {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (socket) => {
    sockets.add(socket);
    let session: BridgeCallSession | undefined;
    let socketClosed = false;
    const mediaStartTimer = setTimeout(() => {
      closeSocket(socket, 1008, "MEDIA_START timeout");
    }, options.config.mediaStartTimeoutMs);

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        if (!session) {
          closeSocket(socket, 1002, "MEDIA_START required before audio");
          return;
        }
        try {
          session.pushCallerAudio(rawDataToBytes(data));
        } catch (error) {
          console.warn("[voice-bridge] invalid caller audio", {
            roomName: session.roomName,
            error: error instanceof Error ? error.message : String(error),
          });
          closeSocket(socket, 1007, "Invalid PCM audio");
        }
        return;
      }

      let control;
      try {
        control = parseMediaControl(data.toString());
      } catch (error) {
        console.warn("[voice-bridge] invalid control message", {
          error: error instanceof Error ? error.message : String(error),
        });
        closeSocket(socket, 1002, "Invalid media control message");
        return;
      }

      if (control.event === "MEDIA_START") {
        if (session) {
          closeSocket(socket, 1002, "Duplicate MEDIA_START");
          return;
        }
        clearTimeout(mediaStartTimer);
        session = createSession({
          start: control,
          config: options.config,
          sendAsteriskAudio: (bytes) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(bytes, { binary: true });
            }
          },
          onClosed: (reason) => {
            if (!socketClosed) {
              closeSocket(socket, 1011, reason);
            }
          },
        });
        const activeSession = session;
        void activeSession.start().then(
          () => {
            console.info("[voice-bridge] call session started", {
              channelId: control.channelId,
              connectionId: control.connectionId,
              roomName: activeSession.roomName,
            });
          },
          (error) => {
            console.error("[voice-bridge] call session failed", {
              channelId: control.channelId,
              error: error instanceof Error ? error.message : String(error),
            });
            closeSocket(socket, 1011, "LiveKit session failed");
            void activeSession.close("start-failed");
          },
        );
        return;
      }

      if (!session) {
        closeSocket(socket, 1002, "MEDIA_START required");
        return;
      }
      if (control.event === "MEDIA_XOFF") {
        session.setAsteriskWritable(false);
      } else if (control.event === "MEDIA_XON") {
        session.setAsteriskWritable(true);
      } else if (control.event === "DTMF_END") {
        console.info("[voice-bridge] DTMF received", {
          roomName: session.roomName,
          digit: control.digit,
        });
      }
    });

    socket.on("close", () => {
      socketClosed = true;
      clearTimeout(mediaStartTimer);
      sockets.delete(socket);
      if (session) {
        void session.close("asterisk-disconnected");
      }
    });

    socket.on("error", (error) => {
      console.warn("[voice-bridge] media websocket error", {
        error: error.message,
      });
    });
  });

  return {
    listen(port = options.config.port) {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, "0.0.0.0", () => {
          httpServer.off("error", reject);
          const address = httpServer.address();
          if (!address || typeof address === "string") {
            reject(new Error("Voice Bridge did not bind a TCP port"));
            return;
          }
          resolve({ port: address.port });
        });
      });
    },
    async close() {
      for (const socket of sockets) {
        socket.terminate();
      }
      sockets.clear();
      await new Promise<void>((resolve) => {
        webSocketServer.close(() => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const server = createVoiceBridgeServer({ config });
  server.listen().then(({ port }) => {
    console.info("[voice-bridge] listening", { port });
  }).catch((error) => {
    console.error("[voice-bridge] failed to start", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
