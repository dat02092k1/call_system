import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SipCallState } from "../asterisk/sipTypes";
import { RealAsteriskCall } from "../components/RealAsteriskCall";

describe("RealAsteriskCall", () => {
  it("starts, displays active state, and hangs up once", async () => {
    const user = userEvent.setup();
    const start = vi.fn().mockResolvedValue(undefined);
    const hangup = vi.fn().mockResolvedValue(undefined);
    const onLeave = vi.fn();
    let update: (state: SipCallState) => void = () => undefined;

    render(
      <RealAsteriskCall
        displayName="Nguyen Van A"
        onLeave={onLeave}
        createClient={(_audio, onStateChange) => {
          update = onStateChange;
          return { start, hangup };
        }}
      />,
    );

    expect(start).toHaveBeenCalledWith("Nguyen Van A");
    expect(screen.getByText("\u0110ang \u0111\u0103ng k\u00fd m\u00e1y nh\u00e1nh\u2026")).toBeVisible();
    act(() => update({ status: "active" }));
    expect(screen.getByText("Cu\u1ed9c g\u1ecdi qua Asterisk \u0111ang ho\u1ea1t \u0111\u1ed9ng")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "K\u1ebft th\u00fac" }));
    expect(hangup).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
