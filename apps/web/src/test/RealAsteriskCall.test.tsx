import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SipCallState } from "../asterisk/sipTypes";
import { RealAsteriskCall } from "../components/RealAsteriskCall";

function callHarness(start = vi.fn().mockResolvedValue(undefined)) {
  const hangup = vi.fn().mockResolvedValue(undefined);
  let update: (state: SipCallState) => void = () => undefined;
  let remoteAudio: HTMLAudioElement | undefined;
  return {
    start,
    hangup,
    update: (state: SipCallState) => update(state),
    remoteAudio: () => remoteAudio,
    createClient: (
      audio: HTMLAudioElement,
      onStateChange: (state: SipCallState) => void,
    ) => {
      remoteAudio = audio;
      update = onStateChange;
      return { start, hangup };
    },
  };
}

describe("RealAsteriskCall", () => {
  it("starts, displays active state, and hangs up once", async () => {
    const user = userEvent.setup();
    const harness = callHarness();
    const onLeave = vi.fn();

    render(
      <RealAsteriskCall
        displayName="Nguyen Van A"
        onLeave={onLeave}
        createClient={harness.createClient}
      />,
    );

    expect(harness.start).toHaveBeenCalledWith("Nguyen Van A");
    expect(screen.getByText("\u0110ang \u0111\u0103ng k\u00fd m\u00e1y nh\u00e1nh\u2026")).toBeVisible();
    act(() => harness.update({ status: "active" }));
    expect(screen.getByText("Cu\u1ed9c g\u1ecdi qua Asterisk \u0111ang ho\u1ea1t \u0111\u1ed9ng")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "K\u1ebft th\u00fac" }));
    expect(harness.hangup).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it.each([
    [
      { status: "calling" } as const,
      "\u0110ang g\u1ecdi s\u1ed1 1000\u2026",
      "\u0110ang thi\u1ebft l\u1eadp cu\u1ed9c g\u1ecdi qua SIP.",
    ],
    [
      { status: "ended" } as const,
      "Cu\u1ed9c g\u1ecdi \u0111\u00e3 k\u1ebft th\u00fac",
      "K\u1ebft n\u1ed1i audio \u0111\u00e3 \u0111\u01b0\u1ee3c \u0111\u00f3ng.",
    ],
    [
      { status: "failed", message: "T\u1ed5ng \u0111\u00e0i t\u1eeb ch\u1ed1i cu\u1ed9c g\u1ecdi." } as const,
      "Kh\u00f4ng th\u1ec3 g\u1ecdi qua Asterisk",
      "T\u1ed5ng \u0111\u00e0i t\u1eeb ch\u1ed1i cu\u1ed9c g\u1ecdi.",
    ],
  ])("renders the %s state copy", (state, title, detail) => {
    const harness = callHarness();
    render(
      <RealAsteriskCall
        displayName="Nguyen Van A"
        onLeave={() => undefined}
        createClient={harness.createClient}
      />,
    );

    act(() => harness.update(state));

    expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByText(detail)).toBeVisible();
  });

  it("renders missing browser SIP configuration as a failed state", async () => {
    render(
      <RealAsteriskCall
        displayName="Nguyen Van A"
        onLeave={() => undefined}
      />,
    );

    expect(
      await screen.findByText("Kh\u00f4ng th\u1ec3 g\u1ecdi qua Asterisk"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Missing browser Asterisk configuration: VITE_ASTERISK_WS_URL",
      ),
    ).toBeVisible();
  });

  it("renders a rejected client start as a failed state", async () => {
    const harness = callHarness(
      vi.fn().mockRejectedValue(new Error("SIP start rejected")),
    );
    render(
      <RealAsteriskCall
        displayName="Nguyen Van A"
        onLeave={() => undefined}
        createClient={harness.createClient}
      />,
    );

    expect(await screen.findByText("SIP start rejected")).toBeVisible();
    expect(screen.getByText("Kh\u00f4ng th\u1ec3 g\u1ecdi qua Asterisk")).toBeVisible();
  });

  it("passes an autoplay audio element to the SIP client", () => {
    const harness = callHarness();
    const { container } = render(
      <RealAsteriskCall
        displayName="Nguyen Van A"
        onLeave={() => undefined}
        createClient={harness.createClient}
      />,
    );

    const audio = container.querySelector("audio");
    expect(audio).toBeInstanceOf(HTMLAudioElement);
    expect(audio?.autoplay).toBe(true);
    expect(harness.remoteAudio()).toBe(audio);
  });

  it("hangs up when unmounted", async () => {
    const harness = callHarness();
    const { unmount } = render(
      <RealAsteriskCall
        displayName="Nguyen Van A"
        onLeave={() => undefined}
        createClient={harness.createClient}
      />,
    );

    unmount();

    await waitFor(() => expect(harness.hangup).toHaveBeenCalledOnce());
  });

  it("does not hang up again when leave is followed by unmount", async () => {
    const user = userEvent.setup();
    const harness = callHarness();
    const { unmount } = render(
      <RealAsteriskCall
        displayName="Nguyen Van A"
        onLeave={() => undefined}
        createClient={harness.createClient}
      />,
    );

    await user.click(screen.getByRole("button", { name: "K\u1ebft th\u00fac" }));
    unmount();

    expect(harness.hangup).toHaveBeenCalledOnce();
  });
});
