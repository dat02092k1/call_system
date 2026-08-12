import { describe, expect, it, vi } from "vitest";
import { createTransferToAgentTool, toLiveKitHttpUrl } from "../src/transfer.js";

const call = {
  callId: "SCL_demo",
  phoneNumber: "0901234567",
  roomName: "sip-room-demo",
  participantIdentity: "sip_0901234567",
};

describe("transfer_to_agent tool", () => {
  it("gets an approved destination and transfers the SIP participant", async () => {
    const getTransferTarget = vi.fn().mockResolvedValue({
      available: true,
      transferTo: "sip:2001@127.0.0.1:5092",
      agentName: "CTV Demo",
    });
    const transferSipParticipant = vi.fn().mockResolvedValue(undefined);
    const tool = createTransferToAgentTool({
      call,
      orchestrator: { getTransferTarget },
      sip: { transferSipParticipant },
    });

    const result = await tool.execute(
      { reason: "Khach hang can CTV ho tro" },
      {} as never,
    );

    expect(result).toEqual({ status: "transferred", agentName: "CTV Demo" });
    expect(getTransferTarget).toHaveBeenCalledWith({
      callId: "SCL_demo",
      phoneNumber: "0901234567",
      reason: "Khach hang can CTV ho tro",
    });
    expect(transferSipParticipant).toHaveBeenCalledWith(
      "sip-room-demo",
      "sip_0901234567",
      "sip:2001@127.0.0.1:5092",
      { playDialtone: true },
    );
  });

  it("does not call LiveKit when no CTV is available", async () => {
    const transferSipParticipant = vi.fn();
    const tool = createTransferToAgentTool({
      call,
      orchestrator: {
        getTransferTarget: vi.fn().mockResolvedValue({ available: false }),
      },
      sip: { transferSipParticipant },
    });

    await expect(
      tool.execute({ reason: "Can ho tro" }, {} as never),
    ).resolves.toEqual({ status: "unavailable" });
    expect(transferSipParticipant).not.toHaveBeenCalled();
  });

  it("rejects an unsafe destination returned by the orchestrator", async () => {
    const transferSipParticipant = vi.fn();
    const tool = createTransferToAgentTool({
      call,
      orchestrator: {
        getTransferTarget: vi.fn().mockResolvedValue({
          available: true,
          transferTo: "https://example.com",
          agentName: "CTV Demo",
        }),
      },
      sip: { transferSipParticipant },
    });

    await expect(
      tool.execute({ reason: "Can ho tro" }, {} as never),
    ).resolves.toEqual({ status: "failed" });
    expect(transferSipParticipant).not.toHaveBeenCalled();
  });
});

describe("toLiveKitHttpUrl", () => {
  it("converts websocket URLs for the server API client", () => {
    expect(toLiveKitHttpUrl("ws://livekit:7880")).toBe("http://livekit:7880");
    expect(toLiveKitHttpUrl("wss://rtc.example.com")).toBe(
      "https://rtc.example.com",
    );
  });
});
