import { describe, expect, it, vi } from "vitest";
import { llm } from "@livekit/agents";
import { createTranscriptLogHandlers } from "../src/transcript.js";

const context = {
  callId: "SCL_demo",
  roomName: "sip-call-demo",
};

describe("transcript logging", () => {
  it("logs only final customer transcripts", () => {
    const write = vi.fn();
    const handlers = createTranscriptLogHandlers(context, write);

    handlers.onUserInputTranscribed({
      transcript: "Tôi muốn gặp chuyên viên.",
      isFinal: false,
    } as never);
    handlers.onUserInputTranscribed({
      transcript: "Tôi muốn gặp chuyên viên.",
      isFinal: true,
    } as never);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({
      event: "conversation-transcript",
      callId: "SCL_demo",
      roomName: "sip-call-demo",
      speaker: "customer",
      text: "Tôi muốn gặp chuyên viên.",
    });
  });

  it("logs Gemini assistant transcription from conversation items", () => {
    const write = vi.fn();
    const handlers = createTranscriptLogHandlers(context, write);
    const assistantMessage = llm.ChatMessage.create({
      role: "assistant",
      content: ["Dạ, em sẽ hỗ trợ Anh/Chị."],
    });

    handlers.onConversationItemAdded({ item: assistantMessage } as never);

    expect(write).toHaveBeenCalledWith({
      event: "conversation-transcript",
      callId: "SCL_demo",
      roomName: "sip-call-demo",
      speaker: "assistant",
      text: "Dạ, em sẽ hỗ trợ Anh/Chị.",
    });
  });

  it("ignores user conversation items to avoid duplicate customer logs", () => {
    const write = vi.fn();
    const handlers = createTranscriptLogHandlers(context, write);
    const userMessage = llm.ChatMessage.create({
      role: "user",
      content: ["Xin chào."],
    });

    handlers.onConversationItemAdded({ item: userMessage } as never);

    expect(write).not.toHaveBeenCalled();
  });
});
