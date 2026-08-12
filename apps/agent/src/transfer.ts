import { llm } from "@livekit/agents";
import { z } from "zod";
import type {
  TransferTargetRequest,
  TransferTarget,
} from "./orchestrator.js";

type ActiveSipCall = {
  callId: string;
  phoneNumber: string;
  roomName: string;
  participantIdentity: string;
};

type TransferOrchestrator = {
  getTransferTarget(request: TransferTargetRequest): Promise<TransferTarget>;
};

type SipTransferClient = {
  transferSipParticipant(
    roomName: string,
    participantIdentity: string,
    transferTo: string,
    options: { playDialtone: boolean },
  ): Promise<void>;
};

type TransferToolDependencies = {
  call: ActiveSipCall;
  orchestrator: TransferOrchestrator;
  sip: SipTransferClient;
};

const isSafeTransferDestination = (value: string) =>
  /^(sip:|tel:)[^\s\r\n]{1,250}$/i.test(value);

export function createTransferToAgentTool({
  call,
  orchestrator,
  sip,
}: TransferToolDependencies) {
  return llm.tool({
    name: "transfer_to_agent",
    description:
      "Chuyển cuộc gọi sang CTV khi bạn không thể giải quyết yêu cầu. " +
      "Chỉ gọi công cụ sau khi đã hỏi và người gọi xác nhận đồng ý chuyển.",
    parameters: z.object({
      reason: z
        .string()
        .min(1)
        .max(500)
        .describe("Lý do nghiệp vụ cần chuyển sang CTV"),
    }),
    onDuplicate: "reject",
    execute: async ({ reason }) => {
      try {
        const target = await orchestrator.getTransferTarget({
          callId: call.callId,
          phoneNumber: call.phoneNumber,
          reason: reason.trim(),
        });

        if (!target.available) {
          return { status: "unavailable" as const };
        }

        if (!isSafeTransferDestination(target.transferTo)) {
          console.error("Transfer target rejected: invalid SIP destination");
          return { status: "failed" as const };
        }

        await sip.transferSipParticipant(
          call.roomName,
          call.participantIdentity,
          target.transferTo,
          { playDialtone: true },
        );

        return {
          status: "transferred" as const,
          agentName: target.agentName,
        };
      } catch (error) {
        console.error(
          "Cold transfer failed",
          error instanceof Error ? error.message : error,
        );
        return { status: "failed" as const };
      }
    },
  });
}

export function toLiveKitHttpUrl(livekitUrl: string): string {
  if (livekitUrl.startsWith("ws://")) {
    return `http://${livekitUrl.slice("ws://".length)}`;
  }
  if (livekitUrl.startsWith("wss://")) {
    return `https://${livekitUrl.slice("wss://".length)}`;
  }
  if (livekitUrl.startsWith("http://") || livekitUrl.startsWith("https://")) {
    return livekitUrl;
  }
  throw new Error("LIVEKIT_URL must use ws://, wss://, http:// or https://");
}
