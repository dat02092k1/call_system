import { createCallOrchestratorServer } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3002", 10);
const server = createCallOrchestratorServer();

server.listen(port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      event: "call-orchestrator-listening",
      port,
    }),
  );
});
