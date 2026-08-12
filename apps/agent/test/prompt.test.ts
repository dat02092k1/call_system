import { describe, expect, it } from "vitest";
import {
  AGENT_INSTRUCTIONS,
  APPROVED_GREETING,
  createAgentInstructions,
  GREETING_INSTRUCTIONS,
} from "../src/prompt.js";

describe("TCBS voice prompt", () => {
  it("defines the TCBS customer-care role and product context", () => {
    expect(AGENT_INSTRUCTIONS).toContain(
      "Công ty Cổ phần Chứng khoán Kỹ thương (TCBS)",
    );
    expect(AGENT_INSTRUCTIONS).toContain('Sử dụng "TCBS" hoặc "Em"');
    expect(AGENT_INSTRUCTIONS).toContain("TCInvest");
    expect(AGENT_INSTRUCTIONS).toContain("iBond");
    expect(AGENT_INSTRUCTIONS).toContain("iFund");
    expect(AGENT_INSTRUCTIONS).toContain("Margin");
  });

  it("enforces concise speech and safe financial answers", () => {
    expect(AGENT_INSTRUCTIONS).toContain("dưới 2 câu mỗi lượt thoại");
    expect(AGENT_INSTRUCTIONS).toContain("KHÔNG tự bịa đặt thông tin tài chính");
    expect(AGENT_INSTRUCTIONS).toContain("không sử dụng Markdown");
    expect(AGENT_INSTRUCTIONS).toContain(
      "Dạ, em chưa nghe rõ, Anh/Chị có thể vui lòng chia sẻ lại giúp em được không ạ?",
    );
  });

  it("connects human escalation to the transfer tool after confirmation", () => {
    expect(AGENT_INSTRUCTIONS).toContain("transfer_to_agent");
    expect(AGENT_INSTRUCTIONS).toContain("xác nhận đồng ý chuyển");
    expect(AGENT_INSTRUCTIONS).toContain(
      "Dạ, em xin phép ghi nhận yêu cầu và chuyển hướng cuộc gọi đến chuyên viên tư vấn là người thật để hỗ trợ Anh/Chị ngay nhé ạ.",
    );
  });

  it("contains the approved TCBS greeting", () => {
    expect(APPROVED_GREETING).toBe(
      "Xin chào Anh/Chị! Em là bot tư vấn chăm sóc khách hàng từ công ty chứng khoán TCBS. Em có thể hỗ trợ gì cho Anh/Chị trong phiên giao dịch hôm nay ạ?",
    );
    expect(GREETING_INSTRUCTIONS).toContain(APPROVED_GREETING);
  });

  it("injects normalized customer context into the instructions", () => {
    const instructions = createAgentInstructions({
      nameCustomer: "Nguyễn Văn A",
    });

    expect(instructions).toContain(AGENT_INSTRUCTIONS);
    expect(instructions).toContain("Nguyễn Văn A");
    expect(instructions).toContain("Thông tin nghiệp vụ");
  });
});
