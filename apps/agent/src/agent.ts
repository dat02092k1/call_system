import {
  ServerOptions,
  cli,
  defineAgent,
  type JobContext,
  type JobRequest,
  voice,
} from "@livekit/agents";
import * as google from "@livekit/agents-plugin-google";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import {
  createAgentInstructions,
  GREETING_INSTRUCTIONS,
} from "./prompt.js";
import {
  createCallOrchestratorClient,
  prepareInboundCallContext,
} from "./orchestrator.js";
import { createSessionOptions } from "./session.js";

const config = loadConfig();
const callOrchestrator = createCallOrchestratorClient(
  config.callOrchestratorUrl,
);

export default defineAgent({
  entry: async (context: JobContext) => {
    await context.connect();
    const participant = await context.waitForParticipant();
    const customerContext = await prepareInboundCallContext(
      {
        identity: participant.identity,
        attributes: participant.attributes,
      },
      callOrchestrator,
    );

    const session = new voice.AgentSession({
      llm: new google.realtime.RealtimeModel(
        createSessionOptions(config),
      ),
    });

    await session.start({
      agent: new voice.Agent({
        instructions: createAgentInstructions(customerContext),
      }),
      room: context.room,
    });

    session.generateReply({
      instructions: GREETING_INSTRUCTIONS,
      allowInterruptions: true,
    });
  },
});

const requestFunc = async (request: JobRequest) => {
  await request.accept("Trợ lý AI");
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      requestFunc,
      wsURL: config.livekitUrl,
      apiKey: config.livekitApiKey,
      apiSecret: config.livekitApiSecret,
      host: "0.0.0.0",
      port: 8081,
    }),
  );
}
