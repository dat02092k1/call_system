export type Config = {
  apiKey: string;
  apiSecret: string;
  corsOrigin: string;
  port: number;
};

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Config {
  const apiKey = environment.LIVEKIT_API_KEY;
  const apiSecret = environment.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error(
      "LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required.",
    );
  }

  return {
    apiKey,
    apiSecret,
    corsOrigin: environment.CORS_ORIGIN || "http://localhost:5173",
    port: Number(environment.PORT || 3001),
  };
}
