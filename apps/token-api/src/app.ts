import cors from "cors";
import express, { type Express } from "express";
import type { TokenIssuer } from "./token.js";
import { validateTokenRequest } from "./validation.js";

export type AppDependencies = {
  issueToken: TokenIssuer;
  corsOrigin: string;
};

export function createApp({
  issueToken,
  corsOrigin,
}: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post("/api/token", async (request, response) => {
    const validation = validateTokenRequest(request.body);
    if (!validation.ok) {
      response.status(400).json({
        error: "Please correct the highlighted fields.",
        fields: validation.fields,
      });
      return;
    }

    try {
      const issued = await issueToken(validation.value);
      response.json({ ...issued, ...validation.value });
    } catch (error) {
      console.error("Token issuance failed", error);
      response.status(500).json({
        error: "Could not create a call token. Please try again.",
      });
    }
  });

  return app;
}
