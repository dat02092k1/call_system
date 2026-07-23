import { describe, expect, it } from "vitest";
import { validateTokenRequest } from "../src/validation.js";

describe("validateTokenRequest", () => {
  it("normalizes valid display and room names", () => {
    expect(
      validateTokenRequest({
        displayName: "  Ada Lovelace  ",
        roomName: "  demo_room  ",
      }),
    ).toEqual({
      ok: true,
      value: { displayName: "Ada Lovelace", roomName: "demo_room" },
    });
  });

  it("rejects an invalid room name", () => {
    expect(
      validateTokenRequest({ displayName: "Ada", roomName: "demo room" }),
    ).toEqual({
      ok: false,
      fields: {
        roomName:
          "Use 1–64 letters, numbers, underscores, or hyphens.",
      },
    });
  });
});
