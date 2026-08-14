import { describe, expect, it } from "vitest";
import { createWebCallRoomName } from "../webCall";

describe("createWebCallRoomName", () => {
  it("creates a valid room name from stable inputs", () => {
    expect(createWebCallRoomName(1_786_700_000_000, 0.5)).toBe(
      "web-call-1786700000000-apsw",
    );
  });
});
