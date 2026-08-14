import { useState, type FormEvent } from "react";
import { createWebCallRoomName } from "../webCall";

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
  const [displayError, setDisplayError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedDisplayName = displayName.trim();
    const nextDisplayError =
      normalizedDisplayName.length < 1
        ? "Vui lòng nhập tên khách hàng."
        : normalizedDisplayName.length > 64
          ? "Tên khách hàng không được vượt quá 64 ký tự."
          : "";
    setDisplayError(nextDisplayError);

    if (!nextDisplayError) {
      await onJoin({
        displayName: normalizedDisplayName,
        roomName: createWebCallRoomName(),
      });
    }
  }

  return (
    <main className="join-shell">
      <section className="join-card" aria-labelledby="join-title">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            T
          </span>
          TCBS Voice
        </div>
        <div className="hero-copy">
          <p className="eyebrow">Tổng đài chăm sóc khách hàng</p>
          <h1 id="join-title">Kết nối với trợ lý TCBS.</h1>
          <p>
            Thực hiện cuộc gọi thoại trực tiếp tới trợ lý AI. Hãy cho phép
            trình duyệt sử dụng microphone khi được hỏi.
          </p>
        </div>
        <form onSubmit={submit} noValidate>
          <label>
            <span>Tên khách hàng</span>
            <input
              autoComplete="name"
              autoFocus
              maxLength={64}
              placeholder="Ví dụ: Nguyễn Văn A"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-invalid={Boolean(displayError)}
            />
          </label>
          {displayError && <p className="field-error">{displayError}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Đang kết nối…" : "Gọi tổng đài"}
          </button>
        </form>
        <p className="privacy-note">
          <span aria-hidden="true">●</span> Cuộc gọi được xử lý qua LiveKit
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
        <p>Hỗ trợ tức thì.<br />Hội thoại tự nhiên.</p>
      </aside>
    </main>
  );
}
