import "dotenv/config";
import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth/auth.js";
import { FRONTEND_ORIGINS, LIMITS } from "./config.js";
import { errorMiddleware } from "./http.js";
import chatRoutes from "./routes/chat.js";
import githubRoutes from "./routes/github.js";
import projectRoutes from "./routes/projects.js";
import sessionRoutes from "./routes/sessions.js";
import skillRoutes from "./routes/skills.js";
import systemRoutes from "./routes/system.js";
import settingsRoutes from "./routes/settings.js";
import workspaceRoutes from "./routes/workspace.js";

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: FRONTEND_ORIGINS, credentials: true }));
  app.all("/api/auth/*splat", toNodeHandler(auth));
  app.use(express.json({ limit: LIMITS.routerJsonLimit }));

  app.use(
    systemRoutes,
    settingsRoutes,
    githubRoutes,
    projectRoutes,
    sessionRoutes,
    chatRoutes,
    workspaceRoutes,
    skillRoutes,
  );
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  app.use(errorMiddleware);

  return app;
}
