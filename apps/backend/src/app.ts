import "dotenv/config";
import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth/auth.js";
import { LIMITS, config } from "./config.js";
import { errorMiddleware } from "./http.js";
import { registerRoutes } from "./routes/index.js";

export function createApp(): express.Express {
  const app = express();

  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  app.all("/api/auth/*splat", toNodeHandler(auth));
  app.use(express.json({ limit: LIMITS.routerJsonLimit }));

  registerRoutes(app);

  // Keep async route failures (and body-parser errors) as JSON for the client
  // instead of Express's default HTML error page.
  app.use(errorMiddleware);

  return app;
}
