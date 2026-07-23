import { randomUUID } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import type { TokenRequest } from "./validation.js";

export type IssuedToken = {
  token: string;
  identity: string;
};

export type TokenIssuer = (request: TokenRequest) => Promise<IssuedToken>;

export function createTokenIssuer(
  apiKey: string,
  apiSecret: string,
): TokenIssuer {
  return async ({ displayName, roomName }) => {
    const identity = `${slug(displayName)}-${randomUUID()}`;
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName,
      ttl: "10m",
    });
    accessToken.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    return { token: await accessToken.toJwt(), identity };
  };
}

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return normalized || "caller";
}
