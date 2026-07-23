import { afterEach, describe, expect, it, vi } from "vitest";
import { requestToken } from "../api";

afterEach(() => vi.unstubAllGlobals());

describe("requestToken", () => {
  it("returns the complete token response", async () => {
    const response = {
      token: "signed-token",
      identity: "ada-123",
      displayName: "Ada",
      roomName: "demo-room",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      requestToken(
        { displayName: "Ada", roomName: "demo-room" },
        "http://localhost:3001",
      ),
    ).resolves.toEqual(response);
  });

  it("surfaces the API error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Token service unavailable." }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      requestToken(
        { displayName: "Ada", roomName: "demo-room" },
        "http://localhost:3001",
      ),
    ).rejects.toThrow("Token service unavailable.");
  });
});
