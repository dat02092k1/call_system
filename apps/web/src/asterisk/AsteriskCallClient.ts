import { float32ToPcm16, StreamingLinearResampler } from "./pcm";
import type { AsteriskCallDetails, AsteriskCallState } from "./types";

export type AsteriskSocket = {
  binaryType: string;
  readonly readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
};

export type AsteriskAudioIo = {
  start(onMicrophoneSamples: (samples: Float32Array) => void): Promise<number>;
  play(bytes: Uint8Array): void;
  stop(): Promise<void>;
};

type AsteriskCallClientOptions = {
  url: string;
  onStateChange: (state: AsteriskCallState) => void;
  createSocket?: (url: string) => AsteriskSocket;
  createAudioIo?: () => AsteriskAudioIo;
};

function messageBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  }
  return undefined;
}

export class AsteriskCallClient {
  private readonly options: AsteriskCallClientOptions;
  private readonly audio: AsteriskAudioIo;
  private socket?: AsteriskSocket;
  private resampler?: StreamingLinearResampler;
  private started = false;
  private manualClose = false;
  private cleanupPromise?: Promise<void>;
  private state: AsteriskCallState = { status: "idle" };

  constructor(options: AsteriskCallClientOptions) {
    this.options = options;
    this.audio = (options.createAudioIo ?? (() => new BrowserAsteriskAudioIo()))();
  }

  start(details: AsteriskCallDetails): void {
    if (this.started) throw new Error("Asterisk call client is already started");
    this.started = true;
    this.setState({ status: "connecting" });
    const socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(
      this.options.url,
    );
    this.socket = socket;
    socket.binaryType = "arraybuffer";

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "call.start", ...details }));
    });
    socket.addEventListener("message", (event) => {
      void this.handleMessage((event as MessageEvent).data);
    });
    socket.addEventListener("close", () => {
      if (this.manualClose || this.state.status === "failed") return;
      this.setState({ status: "ended" });
      void this.cleanup();
    });
    socket.addEventListener("error", () => {
      if (this.state.status === "failed" || this.manualClose) return;
      this.setState({ status: "failed", message: "Không thể kết nối Mock Asterisk." });
      void this.cleanup();
    });
  }

  async hangup(): Promise<void> {
    if (this.manualClose) return this.cleanup();
    this.manualClose = true;
    if (this.socket?.readyState === 1) {
      this.socket.send(JSON.stringify({ type: "call.hangup" }));
      this.socket.close(1000, "browser-hangup");
    }
    this.setState({ status: "ended" });
    await this.cleanup();
  }

  private async handleMessage(data: unknown): Promise<void> {
    const binary = messageBytes(data);
    if (binary) {
      this.audio.play(binary);
      return;
    }
    if (typeof data !== "string") return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data) as Record<string, unknown>;
    } catch {
      this.setState({ status: "failed", message: "Mock Asterisk trả dữ liệu không hợp lệ." });
      await this.cleanup();
      return;
    }

    if (message.type === "call.ready" && typeof message.callId === "string") {
      try {
        const inputRate = await this.audio.start((samples) => {
          if (!this.resampler || this.socket?.readyState !== 1) return;
          const pcm = float32ToPcm16(this.resampler.process(samples));
          if (pcm.length > 0) this.socket.send(pcm.buffer);
        });
        this.resampler = new StreamingLinearResampler(inputRate, 16_000);
        this.setState({ status: "active", callId: message.callId });
      } catch (error) {
        this.setState({
          status: "failed",
          message: error instanceof Error ? error.message : "Không thể mở microphone.",
        });
        await this.cleanup();
      }
      return;
    }

    if (message.type === "call.failed") {
      this.setState({
        status: "failed",
        message:
          typeof message.message === "string"
            ? message.message
            : "Cuộc gọi Asterisk thất bại.",
      });
      await this.cleanup();
      return;
    }

    if (message.type === "call.ended") {
      this.setState({ status: "ended" });
      await this.cleanup();
    }
  }

  private setState(state: AsteriskCallState): void {
    this.state = state;
    this.options.onStateChange(state);
  }

  private cleanup(): Promise<void> {
    if (!this.cleanupPromise) {
      this.cleanupPromise = this.audio.stop().finally(() => {
        if (this.socket && this.socket.readyState < 2) {
          this.socket.close(1000, "call-cleanup");
        }
      });
    }
    return this.cleanupPromise;
  }
}

class BrowserAsteriskAudioIo implements AsteriskAudioIo {
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private capture?: AudioWorkletNode;
  private nextPlaybackTime = 0;
  private readonly playbackSources = new Set<AudioBufferSourceNode>();

  async start(
    onMicrophoneSamples: (samples: Float32Array) => void,
  ): Promise<number> {
    const context = new AudioContext();
    this.context = context;
    await context.audioWorklet.addModule("/pcm-capture-worklet.js");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    this.stream = stream;
    const source = context.createMediaStreamSource(stream);
    this.source = source;
    const capture = new AudioWorkletNode(context, "pcm-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    this.capture = capture;
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      onMicrophoneSamples(new Float32Array(event.data));
    };
    source.connect(capture);
    await context.resume();
    return context.sampleRate;
  }

  play(bytes: Uint8Array): void {
    const context = this.context;
    if (!context || bytes.byteLength % 2 !== 0) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sampleCount = bytes.byteLength / 2;
    const buffer = context.createBuffer(1, sampleCount, 16_000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = view.getInt16(index * 2, true);
      channel[index] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
    }

    const now = context.currentTime;
    if (
      this.nextPlaybackTime < now ||
      this.nextPlaybackTime > now + 0.5
    ) {
      this.nextPlaybackTime = now + 0.03;
    }
    const output = context.createBufferSource();
    output.buffer = buffer;
    output.connect(context.destination);
    output.onended = () => {
      output.disconnect();
      this.playbackSources.delete(output);
    };
    this.playbackSources.add(output);
    output.start(this.nextPlaybackTime);
    this.nextPlaybackTime += buffer.duration;
  }

  async stop(): Promise<void> {
    for (const output of this.playbackSources) {
      try {
        output.stop();
      } catch {
        // The source may have already ended.
      }
      output.disconnect();
    }
    this.playbackSources.clear();
    this.capture?.disconnect();
    this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }
  }
}
