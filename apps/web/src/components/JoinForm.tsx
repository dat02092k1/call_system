import { useState, type FormEvent } from "react";

export type CallDetails = {
  displayName: string;
  roomName: string;
};

type JoinFormProps = {
  onJoin: (details: CallDetails) => Promise<void> | void;
  busy: boolean;
  error: string;
};

export function JoinForm({ onJoin, busy, error }: JoinFormProps) {
  const [displayName, setDisplayName] = useState("");
  const [roomName, setRoomName] = useState("demo-room");
  const [roomError, setRoomError] = useState("");
  const [displayError, setDisplayError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = {
      displayName: displayName.trim(),
      roomName: roomName.trim(),
    };
    const nextDisplayError =
      normalized.displayName.length < 1 ||
      normalized.displayName.length > 64
        ? "Use a display name between 1 and 64 characters."
        : "";
    const nextRoomError = /^[A-Za-z0-9_-]{1,64}$/.test(
      normalized.roomName,
    )
      ? ""
      : "Use 1–64 letters, numbers, underscores, or hyphens.";
    setDisplayError(nextDisplayError);
    setRoomError(nextRoomError);

    if (!nextDisplayError && !nextRoomError) {
      await onJoin(normalized);
    }
  }

  return (
    <main className="join-shell">
      <section className="join-card" aria-labelledby="join-title">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          Local line
        </div>
        <div className="hero-copy">
          <p className="eyebrow">LiveKit audio room</p>
          <h1 id="join-title">Start a clear conversation.</h1>
          <p>
            Pick a room, invite another browser, and talk in real time.
            Everything stays on your local Docker stack.
          </p>
        </div>
        <form onSubmit={submit} noValidate>
          <label>
            <span>Display name</span>
            <input
              autoComplete="name"
              autoFocus
              maxLength={64}
              placeholder="e.g. Ada"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-invalid={Boolean(displayError)}
            />
          </label>
          {displayError && <p className="field-error">{displayError}</p>}
          <label>
            <span>Room name</span>
            <input
              maxLength={64}
              placeholder="demo-room"
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              aria-invalid={Boolean(roomError)}
            />
          </label>
          {roomError && <p className="field-error">{roomError}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Connecting…" : "Join call"}
          </button>
        </form>
        <p className="privacy-note">
          <span aria-hidden="true">●</span> Local development environment
        </p>
      </section>
      <aside className="join-visual" aria-hidden="true">
        <div className="signal signal-one" />
        <div className="signal signal-two" />
        <div className="signal signal-three" />
        <div className="orb">
          <div className="wave">
            {[18, 32, 48, 72, 50, 34, 20].map((height, index) => (
              <span key={index} style={{ height }} />
            ))}
          </div>
        </div>
        <p>Low latency.<br />No cloud required.</p>
      </aside>
    </main>
  );
}
