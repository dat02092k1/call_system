import { useState } from "react";
import { requestToken, type TokenResponse } from "./api";
import {
  JoinForm,
  type CallDetails,
} from "./components/JoinForm";
import { CallRoom } from "./components/CallRoom";

export function App() {
  const [session, setSession] = useState<TokenResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function join(details: CallDetails) {
    setBusy(true);
    setError("");
    try {
      setSession(await requestToken(details));
    } catch (joinError) {
      setError(
        joinError instanceof Error
          ? joinError.message
          : "Could not join the call.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return (
      <CallRoom
        session={session}
        onLeave={() => setSession(null)}
        onConnectionError={(message) => {
          setError(message);
          setSession(null);
        }}
      />
    );
  }

  return <JoinForm onJoin={join} busy={busy} error={error} />;
}
