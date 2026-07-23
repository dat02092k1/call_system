import type { CallDetails } from "./components/JoinForm";

export type TokenResponse = {
  token: string;
  identity: string;
  displayName: string;
  roomName: string;
};

export async function requestToken(
  details: CallDetails,
  apiUrl = import.meta.env.VITE_TOKEN_API_URL || "http://localhost:3001",
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(details),
    });
  } catch {
    throw new Error(
      "Cannot reach the token service. Check that Docker is running.",
    );
  }

  const body = (await response.json()) as
    | TokenResponse
    | { error?: string };
  if (!response.ok) {
    throw new Error(
      "error" in body && body.error
        ? body.error
        : "Could not join the call.",
    );
  }
  return body as TokenResponse;
}
