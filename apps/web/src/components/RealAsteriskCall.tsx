import { useEffect, useRef, useState } from "react";
import { readSipCallConfig, SipCallClient } from "../asterisk/SipCallClient";
import type { SipCallState } from "../asterisk/sipTypes";

type RealCallClient = {
  start(displayName: string): Promise<void>;
  hangup(): Promise<void>;
};

type RealAsteriskCallProps = {
  displayName: string;
  onLeave: () => void;
  createClient?: (
    audio: HTMLAudioElement,
    onStateChange: (state: SipCallState) => void,
  ) => RealCallClient;
};

function stateCopy(state: SipCallState): {
  title: string;
  detail: string;
  online: boolean;
} {
  if (state.status === "calling") {
    return {
      title: "\u0110ang g\u1ecdi s\u1ed1 1000\u2026",
      detail: "\u0110ang thi\u1ebft l\u1eadp cu\u1ed9c g\u1ecdi qua SIP.",
      online: false,
    };
  }
  if (state.status === "active") {
    return {
      title: "Cu\u1ed9c g\u1ecdi qua Asterisk \u0111ang ho\u1ea1t \u0111\u1ed9ng",
      detail: "Audio \u0111i qua SIP.js \u2192 Asterisk \u2192 Voice Bridge \u2192 LiveKit.",
      online: true,
    };
  }
  if (state.status === "ended") {
    return {
      title: "Cu\u1ed9c g\u1ecdi \u0111\u00e3 k\u1ebft th\u00fac",
      detail: "K\u1ebft n\u1ed1i audio \u0111\u00e3 \u0111\u01b0\u1ee3c \u0111\u00f3ng.",
      online: false,
    };
  }
  if (state.status === "failed") {
    return {
      title: "Kh\u00f4ng th\u1ec3 g\u1ecdi qua Asterisk",
      detail: state.message,
      online: false,
    };
  }
  return {
    title: "\u0110ang \u0111\u0103ng k\u00fd m\u00e1y nh\u00e1nh\u2026",
    detail: "\u0110ang k\u1ebft n\u1ed1i t\u1ed5ng \u0111\u00e0i Asterisk.",
    online: false,
  };
}

function clientFailureMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Kh\u00f4ng th\u1ec3 k\u1ebft n\u1ed1i cu\u1ed9c g\u1ecdi qua Asterisk.";
}

export function RealAsteriskCall({
  displayName,
  onLeave,
  createClient,
}: RealAsteriskCallProps) {
  const [state, setState] = useState<SipCallState>({ status: "idle" });
  const audioRef = useRef<HTMLAudioElement>(null);
  const clientRef = useRef<RealCallClient | undefined>(undefined);
  const leavingRef = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      const client = createClient
        ? createClient(audio, setState)
        : new SipCallClient(readSipCallConfig(import.meta.env), audio, setState);
      clientRef.current = client;
      void client.start(displayName).catch((error: unknown) => {
        setState({ status: "failed", message: clientFailureMessage(error) });
      });

      return () => {
        if (!leavingRef.current) void client.hangup();
      };
    } catch (error) {
      setState({ status: "failed", message: clientFailureMessage(error) });
    }
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
          <span /> {"Asterisk th\u1eadt"}
        </div>
      </header>

      <section className="asterisk-call-card" aria-live="polite">
        <p className="eyebrow">SIP Call</p>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
        <div className={`asterisk-pulse ${copy.online ? "is-active" : ""}`}>
          <div className="wave" aria-hidden="true">
            {[22, 40, 62, 44, 28].map((height, index) => (
              <span key={index} style={{ height }} />
            ))}
          </div>
        </div>
        <p className="asterisk-caller">{"Kh\u00e1ch h\u00e0ng"}: {displayName}</p>
        <audio ref={audioRef} autoPlay />
        <button className="control-button leave-button" onClick={leave} type="button">
          {"K\u1ebft th\u00fac"}
        </button>
      </section>
    </main>
  );
}
