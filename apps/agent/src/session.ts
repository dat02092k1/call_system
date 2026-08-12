import type { AgentConfig } from "./config.js";

export type GeminiSessionOptions = {
  apiKey: string;
  model: string;
  voice: string;
  temperature: number;
  inputAudioTranscription: Record<string, never>;
  outputAudioTranscription: Record<string, never>;
};

export function createSessionOptions(
  config: AgentConfig,
): GeminiSessionOptions {
  return {
    apiKey: config.googleApiKey,
    model: config.model,
    voice: config.voice,
    temperature: 0.7,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}
