import { useEffect, useRef, useState } from "react";
import { AsteriskCallClient } from "../asterisk/AsteriskCallClient";
import type {
  AsteriskCallDetails,
  AsteriskCallState,
} from "../asterisk/types";

type CallClient = {
  start(details: AsteriskCallDetails): void;
  hangup(): Promise<void>;
};

type AsteriskCallProps = {
  displayName: string;
  onLeave: () => void;
  createClient?: (
    onStateChange: (state: AsteriskCallState) => void,
  ) => CallClient;
};

const defaultUrl =
  import.meta.env.VITE_MOCK_ASTERISK_URL || "ws://localhost:8090/call";

function stateCopy(state: AsteriskCallState): {
  title: string;
  detail: string;
  online: boolean;
} {
  if (state.status === "active") {
    return {
      title: "Cuộc gọi đang hoạt động",
      detail: "Audio đang đi qua Asterisk Mock, Voice Bridge và LiveKit.",
      online: true,
    };
  }
  if (state.status === "failed") {
    return { title: "Không thể thực hiện cuộc gọi", detail: state.message, online: false };
  }
  if (state.status === "ended") {
    return { title: "Cuộc gọi đã kết thúc", detail: "Kết nối audio đã được đóng.", online: false };
  }
  return {
    title: "Đang kết nối qua Asterisk…",
    detail: "Đang tạo media session và đưa người gọi vào LiveKit room.",
    online: false,
  };
}

export function AsteriskCall({
  displayName,
  onLeave,
  createClient,
}: AsteriskCallProps) {
  const [state, setState] = useState<AsteriskCallState>({ status: "connecting" });
  const clientRef = useRef<CallClient | undefined>(undefined);
  const leavingRef = useRef(false);

  useEffect(() => {
    const client = createClient
      ? createClient(setState)
      : new AsteriskCallClient({
          url: defaultUrl,
          onStateChange: setState,
        });
    clientRef.current = client;
    client.start({ displayName, phoneNumber: "0900000001" });
    return () => {
      if (!leavingRef.current) void client.hangup();
    };
  }, [createClient, displayName]);

  async function leave() {
    if (leavingRef.current) return;
    leavingRef.current = true;
    await clientRef.current?.hangup();
    onLeave();
  }

  const copy = stateCopy(state);
  return (
    <main className="call-shell asterisk-call-shell">
      <header className="call-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">T</span>
          TCBS Voice
        </div>
        <div className={`connection-pill ${copy.online ? "online" : ""}`}>
          <span /> Asterisk Mock
        </div>
      </header>

      <section className="asterisk-call-card" aria-live="polite">
        <p className="eyebrow">Voice Bridge Demo</p>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
        <div className={`asterisk-pulse ${copy.online ? "is-active" : ""}`}>
          <div className="wave" aria-hidden="true">
            {[22, 40, 62, 44, 28].map((height, index) => (
              <span key={index} style={{ height }} />
            ))}
          </div>
        </div>
        <p className="asterisk-caller">Khách hàng: {displayName}</p>
        <button className="control-button leave-button" onClick={leave} type="button">
          Kết thúc
        </button>
      </section>
    </main>
  );
}
