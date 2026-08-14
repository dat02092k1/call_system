import { RoomAudioRenderer, RoomContext } from "@livekit/components-react";
import {
  ConnectionState,
  Participant,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TokenResponse } from "../api";
import {
  getAgentWaitingStatus,
  toParticipantView,
  type ParticipantView,
} from "../participantView";

type CallRoomProps = {
  session: TokenResponse;
  onLeave: () => void;
  onConnectionError: (message: string) => void;
};

export function CallRoom({
  session,
  onLeave,
  onConnectionError,
}: CallRoomProps) {
  const room = useMemo(
    () => new Room({ adaptiveStream: true, dynacast: true }),
    [],
  );
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Connecting,
  );
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [muted, setMuted] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [agentTimedOut, setAgentTimedOut] = useState(false);

  const refreshParticipants = useCallback(() => {
    const all: Participant[] = [
      room.localParticipant,
      ...room.remoteParticipants.values(),
    ];
    setParticipants(
      all
        .filter((participant) => participant.identity)
        .map((participant) =>
          toParticipantView(
            participant,
            participant === room.localParticipant,
          ),
        ),
    );
    setMuted(
      room.localParticipant.getTrackPublication(Track.Source.Microphone)
        ?.isMuted ?? false,
    );
  }, [room]);

  const hasAgent = participants.some((participant) => participant.isAgent);

  useEffect(() => {
    if (hasAgent) {
      setAgentTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setAgentTimedOut(true), 15_000);
    return () => window.clearTimeout(timer);
  }, [hasAgent]);

  useEffect(() => {
    let active = true;
    const updateState = (state: ConnectionState) => {
      if (active) setConnectionState(state);
    };
    const refresh = () => refreshParticipants();

    room.on(RoomEvent.ConnectionStateChanged, updateState);
    room.on(RoomEvent.ParticipantConnected, refresh);
    room.on(RoomEvent.ParticipantDisconnected, refresh);
    room.on(RoomEvent.TrackPublished, refresh);
    room.on(RoomEvent.TrackUnpublished, refresh);
    room.on(RoomEvent.TrackMuted, refresh);
    room.on(RoomEvent.TrackUnmuted, refresh);

    void (async () => {
      try {
        await room.connect(
          import.meta.env.VITE_LIVEKIT_URL || "ws://localhost:7880",
          session.token,
        );
        await room.localParticipant.setMicrophoneEnabled(true);
        if (active) refreshParticipants();
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error && /permission|denied/i.test(error.message)
            ? "Microphone permission was denied. Allow microphone access and try again."
            : "Could not connect to LiveKit. Check the Docker services and try again.";
        onConnectionError(message);
      }
    })();

    return () => {
      active = false;
      room.removeAllListeners();
      void room.disconnect();
    };
  }, [onConnectionError, refreshParticipants, room, session.token]);

  async function toggleMute() {
    setControlBusy(true);
    try {
      await room.localParticipant.setMicrophoneEnabled(muted);
      refreshParticipants();
    } finally {
      setControlBusy(false);
    }
  }

  async function leave() {
    setControlBusy(true);
    await room.disconnect();
    onLeave();
  }

  const isConnected = connectionState === ConnectionState.Connected;

  return (
    <RoomContext.Provider value={room}>
      <main className="call-shell">
        <header className="call-header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              T
            </span>
            TCBS Voice
          </div>
          <div className={`connection-pill ${isConnected ? "online" : ""}`}>
            <span />
            {formatConnectionState(connectionState)}
          </div>
        </header>

        <section className="room-heading">
          <div>
            <p className="eyebrow">Cuộc gọi WebRTC</p>
            <h1>Đang kết nối tổng đài</h1>
          </div>
          <div className="room-status">
            <p>
              {hasAgent
                ? `${participants.length} người trong cuộc trò chuyện`
                : getAgentWaitingStatus(false, false)}
            </p>
            {!hasAgent && agentTimedOut && (
              <p className="agent-diagnostic" role="status">
                {getAgentWaitingStatus(false, true)}
              </p>
            )}
          </div>
        </section>

        <section
          className="participant-grid"
          aria-label="Call participants"
        >
          {participants.map((participant, index) => (
            <article
              className={`participant-card ${
                participant.muted ? "is-muted" : ""
              } ${participant.isAgent ? "is-agent" : ""}`}
              data-testid={`participant-${participant.identity}`}
              key={participant.identity}
            >
              <div className={`avatar avatar-${index % 4}`}>
                {initials(participant.name)}
                {!participant.muted && (
                  <span className="speaking-ring" aria-hidden="true" />
                )}
              </div>
              <div>
                <h2>
                  {participant.name}
                  {participant.isLocal && <small>You</small>}
                  {participant.isAgent && <small className="ai-badge">AI</small>}
                </h2>
                <p>
                  <MicrophoneIcon off={participant.muted} />
                  {participant.muted ? "Muted" : "Microphone on"}
                </p>
              </div>
            </article>
          ))}
        </section>

        <div className="call-controls" aria-label="Call controls">
          <button
            className={`control-button ${muted ? "muted" : ""}`}
            disabled={!isConnected || controlBusy}
            onClick={toggleMute}
            type="button"
          >
            <MicrophoneIcon off={muted} />
            <span>{muted ? "Bật mic" : "Tắt mic"}</span>
          </button>
          <button
            className="control-button leave-button"
            disabled={controlBusy}
            onClick={leave}
            type="button"
          >
            <PhoneIcon />
            <span>Kết thúc</span>
          </button>
        </div>
        <RoomAudioRenderer />
      </main>
    </RoomContext.Provider>
  );
}

function formatConnectionState(state: ConnectionState) {
  if (state === ConnectionState.Connected) return "Connected";
  if (state === ConnectionState.Reconnecting) return "Reconnecting";
  if (state === ConnectionState.Disconnected) return "Disconnected";
  return "Connecting";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function MicrophoneIcon({ off = false }: { off?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
      <path d="M18 11v1a6 6 0 0 1-10.24 4.24M6 11v1a6 6 0 0 0 9.67 4.74M12 18v3M9 21h6" />
      {off && <path d="m4 4 16 16" />}
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24c1.1.36 2.27.54 3.46.54a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.55 21 3 13.45 3 4.14a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.2.18 2.36.54 3.46a1 1 0 0 1-.25 1Z" />
    </svg>
  );
}
