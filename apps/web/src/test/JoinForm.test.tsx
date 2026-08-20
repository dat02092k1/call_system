import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JoinForm } from "../components/JoinForm";

describe("JoinForm", () => {
  it("starts a web call with a generated room", async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn().mockResolvedValue(undefined);
    render(
      <JoinForm
        onJoin={onJoin}
        onAsteriskCall={vi.fn()}
        busy={false}
        error=""
      />,
    );

    await user.type(screen.getByLabelText("Tên khách hàng"), "  Nguyễn Văn A  ");
    await user.click(
      screen.getByRole("button", { name: "Gọi trực tiếp WebRTC" }),
    );

    expect(onJoin).toHaveBeenCalledOnce();
    expect(onJoin.mock.calls[0][0]).toMatchObject({
      displayName: "Nguyễn Văn A",
    });
    expect(onJoin.mock.calls[0][0].roomName).toMatch(
      /^web-call-[0-9]+-[a-z0-9]+$/,
    );
    expect(screen.queryByLabelText("Room name")).not.toBeInTheDocument();
  });

  it("starts an additive Asterisk Mock call with the same customer name", async () => {
    const user = userEvent.setup();
    const onAsteriskCall = vi.fn().mockResolvedValue(undefined);
    render(
      <JoinForm
        onJoin={vi.fn()}
        onAsteriskCall={onAsteriskCall}
        busy={false}
        error=""
      />,
    );

    await user.type(screen.getByLabelText("Tên khách hàng"), "Nguyen Van A");
    await user.click(
      screen.getByRole("button", { name: "Gọi qua Asterisk Mock" }),
    );

    expect(onAsteriskCall).toHaveBeenCalledOnce();
    expect(onAsteriskCall.mock.calls[0][0]).toMatchObject({
      displayName: "Nguyen Van A",
    });
  });

  it("requires a customer name before starting a call", async () => {
    const user = userEvent.setup();
    render(
      <JoinForm
        onJoin={vi.fn()}
        onAsteriskCall={vi.fn()}
        busy={false}
        error=""
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Gọi trực tiếp WebRTC" }),
    );

    expect(
      screen.getByText("Vui lòng nhập tên khách hàng."),
    ).toBeInTheDocument();
  });
});
