export type TokenRequest = {
  displayName: string;
  roomName: string;
};

export type ValidationResult =
  | { ok: true; value: TokenRequest }
  | { ok: false; fields: Record<string, string> };

export function validateTokenRequest(input: unknown): ValidationResult {
  const value =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const displayName =
    typeof value.displayName === "string" ? value.displayName.trim() : "";
  const roomName =
    typeof value.roomName === "string" ? value.roomName.trim() : "";
  const fields: Record<string, string> = {};

  if (
    displayName.length < 1 ||
    displayName.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(displayName)
  ) {
    fields.displayName =
      "Use a display name between 1 and 64 characters.";
  }

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomName)) {
    fields.roomName =
      "Use 1–64 letters, numbers, underscores, or hyphens.";
  }

  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: { displayName, roomName } };
}
