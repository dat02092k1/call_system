export type VoiceBridgeConfig = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  port: number;
  mediaStartTimeoutMs: number;
  agentStartTimeoutMs: number;
  maxAudioBufferMs: number;
};

type Environment = Record<string, string | undefined>;

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function positiveInteger(
  env: Environment,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function loadConfig(env: Environment = process.env): VoiceBridgeConfig {
  const livekitUrl = required(env, "LIVEKIT_URL");
  if (!/^wss?:\/\//i.test(livekitUrl)) {
    throw new Error("LIVEKIT_URL must use ws:// or wss://");
  }

  return {
    livekitUrl,
    livekitApiKey: required(env, "LIVEKIT_API_KEY"),
    livekitApiSecret: required(env, "LIVEKIT_API_SECRET"),
    port: positiveInteger(env, "VOICE_BRIDGE_PORT", 8091),
    mediaStartTimeoutMs: positiveInteger(env, "MEDIA_START_TIMEOUT_MS", 5_000),
    agentStartTimeoutMs: positiveInteger(env, "AGENT_START_TIMEOUT_MS", 20_000),
    maxAudioBufferMs: positiveInteger(env, "MAX_AUDIO_BUFFER_MS", 500),
  };
}
