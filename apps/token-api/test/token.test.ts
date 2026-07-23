import { describe, expect, it } from "vitest";
import { createTokenIssuer } from "../src/token.js";

describe("createTokenIssuer", () => {
  it("creates unique signed tokens", async () => {
    const issueToken = createTokenIssuer("devkey", "secret");

    const first = await issueToken({
      displayName: "Ada",
      roomName: "demo-room",
    });
    const second = await issueToken({
      displayName: "Ada",
      roomName: "demo-room",
    });

    expect(first.token.split(".")).toHaveLength(3);
    expect(first.identity).not.toBe(second.identity);
  });
});
