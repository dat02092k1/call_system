import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createTokenIssuer } from "./token.js";

const config = loadConfig();
const app = createApp({
  issueToken: createTokenIssuer(config.apiKey, config.apiSecret),
  corsOrigin: config.corsOrigin,
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Token API listening on http://0.0.0.0:${config.port}`);
});
