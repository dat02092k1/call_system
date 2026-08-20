export type MediaStartEvent = {
  event: "MEDIA_START";
  connectionId: string;
  channelId: string;
  format: "slin16";
  optimalFrameSize: number;
  ptime: number;
  channelVariables: Record<string, string>;
};

export type MediaControlEvent =
  | MediaStartEvent
  | { event: "MEDIA_XOFF" }
  | { event: "MEDIA_XON" }
  | { event: "DTMF_END"; digit: string }
  | { event: "UNKNOWN"; name: string };

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Control message must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value as number;
}

function stringVariables(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string"
    ),
  );
}

export function parseMediaControl(text: string): MediaControlEvent {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Control message must be valid JSON");
  }

  const message = asRecord(value);
  const event = nonEmptyString(message.event, "event");

  if (event === "MEDIA_START") {
    if (message.format !== "slin16") {
      throw new Error("MEDIA_START format must be slin16");
    }
    const optimalFrameSize = positiveInteger(
      message.optimal_frame_size,
      "optimal_frame_size",
    );
    if (optimalFrameSize % 2 !== 0) {
      throw new Error("optimal_frame_size must contain complete PCM16 samples");
    }
    return {
      event,
      connectionId: nonEmptyString(message.connection_id, "connection_id"),
      channelId: nonEmptyString(message.channel_id, "channel_id"),
      format: "slin16",
      optimalFrameSize,
      ptime: positiveInteger(message.ptime, "ptime"),
      channelVariables: stringVariables(message.channel_variables),
    };
  }

  if (event === "MEDIA_XOFF" || event === "MEDIA_XON") {
    return { event };
  }

  if (event === "DTMF_END") {
    return {
      event,
      digit: nonEmptyString(message.digit, "digit"),
    };
  }

  return { event: "UNKNOWN", name: event };
}

export function normalizeLiveKitId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  if (!normalized) {
    throw new Error("Cannot create a LiveKit identifier from this value");
  }
  return normalized;
}

export function pcmBytesToSamples(bytes: Uint8Array): Int16Array {
  if (bytes.byteLength % 2 !== 0) {
    throw new Error("PCM16 payload length must be even");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Int16Array(bytes.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true);
  }
  return samples;
}
