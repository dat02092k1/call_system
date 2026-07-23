import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createCallOrchestratorServer } from "../src/app.js";

let server;

afterEach(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  }
});

async function startServer() {
  server = createCallOrchestratorServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

describe("call orchestrator mock API", () => {
  it("reports health", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  it("returns deterministic customer context for an inbound call", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/call-context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callId: "SCL_demo",
        phoneNumber: "0901234567",
        direction: "inbound",
      }),
    });

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type"),
      /application\/json;\s*charset=utf-8/i,
    );
    assert.deepEqual(await response.json(), {
      nameCustomer: "Nguyễn Văn A",
    });
  });

  it("rejects incomplete call information", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/call-context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ direction: "inbound" }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "callId, phoneNumber and direction are required",
    });
  });
});
