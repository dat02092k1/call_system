import { describe, expect, it, vi } from "vitest";
import {
  createCallOrchestratorClient,
  prepareInboundCallContext,
} from "../src/orchestrator.js";

describe("transfer target client", () => {
  it("requests a destination without allowing the LLM to choose it", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          available: true,
          transferTo: "sip:2001@127.0.0.1:5092",
          agentName: "CTV Demo",
        }),
        { status: 200 },
      ),
    );
    const client = createCallOrchestratorClient(
      "http://call-orchestrator:3002",
      fetchImplementation,
    );

    await expect(
      client.getTransferTarget({
        callId: "SCL_demo",
        phoneNumber: "0901234567",
        reason: "Khach hang can CTV ho tro",
      }),
    ).resolves.toEqual({
      available: true,
      transferTo: "sip:2001@127.0.0.1:5092",
      agentName: "CTV Demo",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://call-orchestrator:3002/api/transfer-target",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          callId: "SCL_demo",
          phoneNumber: "0901234567",
          reason: "Khach hang can CTV ho tro",
        }),
      }),
    );
  });
});

describe("call orchestrator client", () => {
  it("posts SIP call information and returns customer context", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ nameCustomer: "Nguyễn Văn A" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createCallOrchestratorClient(
      "http://call-orchestrator:3002",
      fetchImplementation,
    );

    const result = await client.getCallContext({
      callId: "SCL_demo",
      phoneNumber: "0901234567",
      direction: "inbound",
    });

    expect(result).toEqual({ nameCustomer: "Nguyễn Văn A" });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://call-orchestrator:3002/api/call-context",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          callId: "SCL_demo",
          phoneNumber: "0901234567",
          direction: "inbound",
        }),
      }),
    );
  });

  it("uses a safe fallback when the orchestrator is unavailable", async () => {
    const client = {
      getCallContext: vi.fn().mockRejectedValue(new Error("offline")),
    };

    await expect(
      prepareInboundCallContext(
        {
          identity: "sip_0901234567",
          attributes: {
            "sip.callID": "SCL_demo",
            "sip.phoneNumber": "0901234567",
          },
        },
        client,
      ),
    ).resolves.toEqual({ nameCustomer: "Quý khách" });
  });
});
