export type BrowserControl =
  | {
      type: "call.start";
      displayName: string;
      phoneNumber: string;
    }
  | { type: "call.hangup" };

export type MediaStartInput = {
  connectionId: string;
  channelId: string;
  displayName: string;
  phoneNumber: string;
};

function nonEmptyString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${name} must not exceed ${maxLength} characters`);
  }
  return normalized;
}

export function parseBrowserControl(text: string): BrowserControl {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Browser control must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser control must be a JSON object");
  }
  const message = value as Record<string, unknown>;
  if (message.type === "call.hangup") {
    return { type: "call.hangup" };
  }
  if (message.type !== "call.start") {
    throw new Error("Unsupported browser control type");
  }
  return {
    type: "call.start",
    displayName: nonEmptyString(message.displayName, "displayName", 64),
    phoneNumber: nonEmptyString(message.phoneNumber, "phoneNumber", 32),
  };
}

export function createMediaStartEvent(input: MediaStartInput): string {
  return JSON.stringify({
    event: "MEDIA_START",
    connection_id: input.connectionId,
    channel_id: input.channelId,
    format: "slin16",
    optimal_frame_size: 640,
    ptime: 20,
    channel_variables: {
      CALLER_NAME: input.displayName,
      CALLER_NUMBER: input.phoneNumber,
    },
  });
}
