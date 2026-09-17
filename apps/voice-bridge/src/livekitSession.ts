import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  ParticipantKind,
  RemoteAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { BoundedAsyncQueue } from "./audioQueue.js";
import type { VoiceBridgeConfig } from "./config.js";
import {
  normalizeLiveKitId,
  pcmBytesToSamples,
  type MediaStartEvent,
} from "./protocol.js";

export type RtcConnectInput = {
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  roomName: string;
  participantIdentity: string;
  participantName: string;
  attributes: Record<string, string>;
};

export type RtcCallAdapter = {
  connect(input: RtcConnectInput): Promise<void>;
  publishCallerFrame(samples: Int16Array): Promise<void>;
  onAgentFrame(handler: (samples: Int16Array) => void): void;
  onDisconnected(handler: () => void): void;
  disconnect(): Promise<void>;
};

export type CancellableStreamReader = {
  done: Promise<void>;
  cancel(): Promise<void>;
};

export function startCancellableStreamReader<T>(
  stream: ReadableStream<T>,
  onValue: (value: T) => void,
): CancellableStreamReader {
  const reader = stream.getReader();
  let finished = false;
  const done = (async () => {
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) {
          return;
        }
        onValue(result.value);
      }
    } finally {
      finished = true;
      reader.releaseLock();
    }
  })();

  return {
    done,
    async cancel() {
      if (!finished) {
        await reader.cancel();
      }
      await done;
    },
  };
}

type SessionOptions = {
  start: MediaStartEvent;
  config: VoiceBridgeConfig;
  rtc?: RtcCallAdapter;
  sendAsteriskAudio: (bytes: Uint8Array) => void;
  onClosed?: (reason: string) => void;
};

function samplesToPcmBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * 2, samples[index], true);
  }
  return bytes;
}

export class LiveKitCallSession {
  readonly roomName: string;
  readonly participantIdentity: string;

  private readonly startEvent: MediaStartEvent;
  private readonly config: VoiceBridgeConfig;
  private readonly rtc: RtcCallAdapter;
  private readonly sendAsteriskAudio: (bytes: Uint8Array) => void;
  private readonly onClosed?: (reason: string) => void;
  private readonly inbound: BoundedAsyncQueue<Uint8Array>;
  private readonly outbound: BoundedAsyncQueue<Int16Array>;
  private asteriskWritable = true;
  private writableWaiters: Array<() => void> = [];
  private started = false;
  private closePromise?: Promise<void>;
  private inboundPump?: Promise<void>;
  private outboundPump?: Promise<void>;
  private agentStartTimer?: ReturnType<typeof setTimeout>;

  constructor(options: SessionOptions) {
    this.startEvent = options.start;
    this.config = options.config;
    this.rtc = options.rtc ?? new NativeRtcCallAdapter();
    this.sendAsteriskAudio = options.sendAsteriskAudio;
    this.onClosed = options.onClosed;
    this.roomName = normalizeLiveKitId(`asterisk-${options.start.channelId}`);
    this.participantIdentity = normalizeLiveKitId(
      `caller-${options.start.channelId}`,
    );
    const capacity = Math.max(
      1,
      Math.ceil(options.config.maxAudioBufferMs / options.start.ptime),
    );
    this.inbound = new BoundedAsyncQueue(capacity);
    this.outbound = new BoundedAsyncQueue(capacity);
  }

  get droppedFrames() {
    return {
      inbound: this.inbound.droppedCount,
      outbound: this.outbound.droppedCount,
    };
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error("Call session is already started");
    }
    this.started = true;
    this.rtc.onAgentFrame((samples) => {
      if (this.agentStartTimer) {
        clearTimeout(this.agentStartTimer);
        this.agentStartTimer = undefined;
      }
      this.outbound.push(samples.slice());
    });
    this.rtc.onDisconnected(() => {
      void this.close("livekit-disconnected");
    });

    const phoneNumber =
      this.startEvent.channelVariables.CALLER_NUMBER ||
      this.participantIdentity;
    await this.rtc.connect({
      livekitUrl: this.config.livekitUrl,
      apiKey: this.config.livekitApiKey,
      apiSecret: this.config.livekitApiSecret,
      roomName: this.roomName,
      participantIdentity: this.participantIdentity,
      participantName:
        this.startEvent.channelVariables.CALLER_NAME || "Asterisk caller",
      attributes: {
        "telephony.provider": "asterisk",
        "telephony.callId": this.startEvent.channelId,
        "telephony.phoneNumber": phoneNumber,
      },
    });

    this.inboundPump = this.runInboundPump();
    this.outboundPump = this.runOutboundPump();
    this.agentStartTimer = setTimeout(() => {
      void this.close("agent-audio-timeout");
    }, this.config.agentStartTimeoutMs);
  }

  pushCallerAudio(bytes: Uint8Array): boolean {
    if (!this.started || this.closePromise) {
      return false;
    }
    return this.inbound.push(bytes.slice());
  }

  setAsteriskWritable(writable: boolean): void {
    this.asteriskWritable = writable;
    if (writable) {
      for (const resolve of this.writableWaiters.splice(0)) {
        resolve();
      }
    }
  }

  close(reason: string): Promise<void> {
    if (!this.closePromise) {
      this.closePromise = this.closeOnce(reason);
    }
    return this.closePromise;
  }

  private async runInboundPump(): Promise<void> {
    for (;;) {
      const bytes = await this.inbound.shift();
      if (!bytes) {
        return;
      }
      await this.rtc.publishCallerFrame(pcmBytesToSamples(bytes));
    }
  }

  private async runOutboundPump(): Promise<void> {
    for (;;) {
      const samples = await this.outbound.shift();
      if (!samples) {
        return;
      }
      await this.waitUntilAsteriskWritable();
      if (this.closePromise) {
        return;
      }
      this.sendAsteriskAudio(samplesToPcmBytes(samples));
    }
  }

  private waitUntilAsteriskWritable(): Promise<void> {
    if (this.asteriskWritable || this.closePromise) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.writableWaiters.push(resolve);
    });
  }

  private async closeOnce(reason: string): Promise<void> {
    if (this.agentStartTimer) {
      clearTimeout(this.agentStartTimer);
      this.agentStartTimer = undefined;
    }
    this.inbound.close();
    this.outbound.close();
    this.setAsteriskWritable(true);
    await Promise.allSettled(
      [this.inboundPump, this.outboundPump].filter(
        (pump): pump is Promise<void> => Boolean(pump),
      ),
    );
    await this.rtc.disconnect();
    this.onClosed?.(reason);
  }
}

class NativeRtcCallAdapter implements RtcCallAdapter {
  private readonly room = new Room();
  private source?: AudioSource;
  private callerTrack?: LocalAudioTrack;
  private agentReader?: CancellableStreamReader;
  private agentFrameHandler: (samples: Int16Array) => void = () => undefined;
  private disconnectedHandler: () => void = () => undefined;
  private disconnecting = false;

  onAgentFrame(handler: (samples: Int16Array) => void): void {
    this.agentFrameHandler = handler;
  }

  onDisconnected(handler: () => void): void {
    this.disconnectedHandler = handler;
  }

  async connect(input: RtcConnectInput): Promise<void> {
    const token = new AccessToken(input.apiKey, input.apiSecret, {
      identity: input.participantIdentity,
      name: input.participantName,
      attributes: input.attributes,
      ttl: "1h",
    });
    token.addGrant({
      roomJoin: true,
      room: input.roomName,
      canPublish: true,
      canSubscribe: true,
    });

    this.room.on(RoomEvent.Disconnected, () => {
      if (!this.disconnecting) {
        this.disconnectedHandler();
      }
    });
    this.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (
        participant.kind === ParticipantKind.AGENT &&
        track instanceof RemoteAudioTrack
      ) {
        void this.consumeAgentTrack(track);
      }
    });

    await this.room.connect(input.livekitUrl, await token.toJwt(), {
      autoSubscribe: true,
      dynacast: false,
    });
    this.source = new AudioSource(16_000, 1);
    this.callerTrack = LocalAudioTrack.createAudioTrack(
      "caller-audio",
      this.source,
    );
    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_MICROPHONE;
    const localParticipant = this.room.localParticipant;
    if (!localParticipant) {
      throw new Error("LiveKit connected without a local participant");
    }
    await localParticipant.publishTrack(this.callerTrack, publishOptions);
  }

  async publishCallerFrame(samples: Int16Array): Promise<void> {
    if (!this.source) {
      throw new Error("RTC audio source is not connected");
    }
    await this.source.captureFrame(
      new AudioFrame(samples, 16_000, 1, samples.length),
    );
  }

  async disconnect(): Promise<void> {
    if (this.disconnecting) {
      return;
    }
    this.disconnecting = true;
    await this.agentReader?.cancel();
    this.agentReader = undefined;
    await this.callerTrack?.close();
    await this.room.disconnect();
  }

  private async consumeAgentTrack(track: RemoteAudioTrack): Promise<void> {
    await this.agentReader?.cancel();
    const stream = new AudioStream(track, {
      sampleRate: 16_000,
      numChannels: 1,
      frameSizeMs: 20,
    });
    let activeReader: CancellableStreamReader;
    activeReader = startCancellableStreamReader(stream, (frame) => {
      if (!this.disconnecting && this.agentReader === activeReader) {
        this.agentFrameHandler(frame.data.slice());
      }
    });
    this.agentReader = activeReader;
    await activeReader.done;
    if (this.agentReader === activeReader) {
      this.agentReader = undefined;
    }
  }
}

export function createLiveKitCallSession(
  options: Omit<SessionOptions, "rtc">,
): LiveKitCallSession {
  return new LiveKitCallSession(options);
}
