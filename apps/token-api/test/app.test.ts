import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

describe("token API", () => {
  it("reports health", async () => {
    const app = createApp({
      issueToken: vi.fn(),
      corsOrigin: "http://localhost:5173",
    });

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("returns a token for normalized input", async () => {
    const issueToken = vi.fn().mockResolvedValue({
      token: "signed-token",
      identity: "ada-123",
    });
    const app = createApp({
      issueToken,
      corsOrigin: "http://localhost:5173",
    });

    const response = await request(app).post("/api/token").send({
      displayName: "  Ada  ",
      roomName: "  demo-room  ",
    });

    expect(response.status).toBe(200);
    expect(issueToken).toHaveBeenCalledWith({
      displayName: "Ada",
      roomName: "demo-room",
    });
    expect(response.body).toEqual({
      token: "signed-token",
      identity: "ada-123",
      displayName: "Ada",
      roomName: "demo-room",
    });
  });

  it("returns field errors for invalid input", async () => {
    const app = createApp({
      issueToken: vi.fn(),
      corsOrigin: "http://localhost:5173",
    });

    const response = await request(app)
      .post("/api/token")
      .send({ displayName: "", roomName: "bad room" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Please correct the highlighted fields.");
    expect(response.body.fields).toHaveProperty("displayName");
    expect(response.body.fields).toHaveProperty("roomName");
  });
});
