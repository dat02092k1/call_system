import { Track } from "livekit-client";

type ParticipantLike = {
  identity: string;
  name?: string;
  isAgent: boolean;
  getTrackPublication: (
    source: Track.Source,
  ) => { isMuted: boolean } | undefined;
};

export type ParticipantView = {
  identity: string;
  name: string;
  isLocal: boolean;
  isAgent: boolean;
  muted: boolean;
};

export function toParticipantView(
  participant: ParticipantLike,
  isLocal: boolean,
): ParticipantView {
  return {
    identity: participant.identity,
    name: participant.isAgent
      ? "Trợ lý AI"
      : participant.name || participant.identity,
    isLocal,
    isAgent: participant.isAgent,
    muted:
      participant.getTrackPublication(Track.Source.Microphone)?.isMuted ??
      true,
  };
}

export function getAgentWaitingStatus(
  hasAgent: boolean,
  timedOut: boolean,
): string {
  if (hasAgent) return "";
  if (timedOut) {
    return "Trợ lý AI chưa tham gia. Hãy kiểm tra: docker compose logs agent";
  }
  return "Đang chờ Trợ lý AI tham gia…";
}
