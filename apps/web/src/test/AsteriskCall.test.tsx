import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AsteriskCallState } from "../asterisk/types";
import { AsteriskCall } from "../components/AsteriskCall";

describe("AsteriskCall", () => {
  it("starts the client, shows active state, and hangs up cleanly", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const hangup = vi.fn().mockResolvedValue(undefined);
    const onLeave = vi.fn();
    let updateState: (state: AsteriskCallState) => void = () => undefined;

    render(
      <AsteriskCall
        displayName="Nguyen Van A"
        onLeave={onLeave}
        createClient={(onStateChange) => {
          updateState = onStateChange;
          return { start, hangup };
        }}
      />,
    );

    expect(start).toHaveBeenCalledWith({
      displayName: "Nguyen Van A",
      phoneNumber: "0900000001",
    });
    expect(screen.getByText("Đang kết nối qua Asterisk…")).toBeInTheDocument();

    act(() => updateState({ status: "active", callId: "mock-1" }));
    expect(screen.getByText("Cuộc gọi đang hoạt động")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Kết thúc" }));
    expect(hangup).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
