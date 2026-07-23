export type AgentConfig = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  googleApiKey: string;
  callOrchestratorUrl: string;
  model: string;
  voice: string;
};

const requiredVariables = [
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "GOOGLE_API_KEY",
] as const;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AgentConfig {
  for (const name of requiredVariables) {
    if (!environment[name]?.trim()) {
      throw new Error(`${name} is required`);
    }
  }

  return {
    livekitUrl: environment.LIVEKIT_URL!.trim(),
    livekitApiKey: environment.LIVEKIT_API_KEY!.trim(),
    livekitApiSecret: environment.LIVEKIT_API_SECRET!.trim(),
    googleApiKey: environment.GOOGLE_API_KEY!.trim(),
    callOrchestratorUrl:
      environment.CALL_ORCHESTRATOR_URL?.trim() ||
      "http://call-orchestrator:3002",
    model: "gemini-2.5-flash-native-audio-preview-12-2025",
    voice: "Puck",
  };
}
