import { describe, expect, it } from "vitest";
import {
  getAgentWaitingStatus,
  toParticipantView,
} from "../participantView";

function participant(overrides: {
  identity: string;
  name?: string;
  isAgent?: boolean;
  muted?: boolean;
}) {
  return {
    identity: overrides.identity,
    name: overrides.name,
    isAgent: overrides.isAgent ?? false,
    getTrackPublication: () => ({
      isMuted: overrides.muted ?? false,
    }),
  };
}

describe("toParticipantView", () => {
  it("preserves a human participant name", () => {
    expect(
      toParticipantView(
        participant({ identity: "ada-1", name: "Ada" }),
        true,
      ),
    ).toMatchObject({
      identity: "ada-1",
      name: "Ada",
      isAgent: false,
      isLocal: true,
    });
  });

  it("labels an agent participant in Vietnamese", () => {
    expect(
      toParticipantView(
        participant({
          identity: "agent-job",
          name: "backend-name",
          isAgent: true,
        }),
        false,
      ),
    ).toMatchObject({
      name: "Trợ lý AI",
      isAgent: true,
      isLocal: false,
    });
  });
});

describe("getAgentWaitingStatus", () => {
  it("shows the waiting message before the diagnostic timeout", () => {
    expect(getAgentWaitingStatus(false, false)).toBe(
      "Đang chờ Trợ lý AI tham gia…",
    );
  });

  it("shows diagnostic guidance after the timeout", () => {
    expect(getAgentWaitingStatus(false, true)).toContain(
      "docker compose logs agent",
    );
    expect(getAgentWaitingStatus(true, true)).toBe("");
  });
});
