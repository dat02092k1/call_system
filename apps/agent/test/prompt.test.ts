import { describe, expect, it } from "vitest";
import {
  AGENT_INSTRUCTIONS,
  APPROVED_GREETING,
  createAgentInstructions,
  GREETING_INSTRUCTIONS,
} from "../src/prompt.js";

describe("Vietnamese voice prompt", () => {
  it("requires concise spoken Vietnamese without unsupported actions", () => {
    expect(AGENT_INSTRUCTIONS).toContain("tiếng Việt");
    expect(AGENT_INSTRUCTIONS).toContain("ngắn gọn");
    expect(AGENT_INSTRUCTIONS).toContain("không có công cụ");
    expect(AGENT_INSTRUCTIONS).toContain("không dùng Markdown");
  });

  it("contains the approved proactive greeting", () => {
    expect(APPROVED_GREETING).toBe(
      "Xin chào, tôi là trợ lý AI. Tôi có thể giúp gì cho bạn?",
    );
    expect(GREETING_INSTRUCTIONS).toContain(APPROVED_GREETING);
  });

  it("injects normalized customer context into the agent instructions", () => {
    const instructions = createAgentInstructions({
      nameCustomer: "Nguyễn Văn A",
    });

    expect(instructions).toContain(AGENT_INSTRUCTIONS);
    expect(instructions).toContain("Nguyễn Văn A");
    expect(instructions).toContain("Thông tin nghiệp vụ");
  });
});
