import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JoinForm } from "../components/JoinForm";

describe("JoinForm", () => {
  it("submits trimmed call details", async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn().mockResolvedValue(undefined);
    render(<JoinForm onJoin={onJoin} busy={false} error="" />);

    await user.type(screen.getByLabelText("Display name"), "  Ada  ");
    await user.clear(screen.getByLabelText("Room name"));
    await user.type(screen.getByLabelText("Room name"), "  demo-room  ");
    await user.click(screen.getByRole("button", { name: "Join call" }));

    expect(onJoin).toHaveBeenCalledWith({
      displayName: "Ada",
      roomName: "demo-room",
    });
  });

  it("shows a room-name validation error", async () => {
    const user = userEvent.setup();
    render(<JoinForm onJoin={vi.fn()} busy={false} error="" />);

    await user.type(screen.getByLabelText("Display name"), "Ada");
    await user.clear(screen.getByLabelText("Room name"));
    await user.type(screen.getByLabelText("Room name"), "bad room");
    await user.click(screen.getByRole("button", { name: "Join call" }));

    expect(
      screen.getByText(
        "Use 1–64 letters, numbers, underscores, or hyphens.",
      ),
    ).toBeInTheDocument();
  });
});
