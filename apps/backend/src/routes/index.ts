import type { Express } from "express";
import { registerSystemRoutes } from "./system.js";
import { registerChatRoutes } from "./chat.js";
import { registerGitHubRoutes } from "./github.js";
import { registerProjectRoutes } from "./projects.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerWorkspaceRoutes } from "./workspace.js";
import { registerBotRoutes } from "./bot.js";

export function registerRoutes(app: Express): void {
  registerSystemRoutes(app);
  registerGitHubRoutes(app);
  registerProjectRoutes(app);
  registerSessionRoutes(app);
  registerChatRoutes(app);
  registerBotRoutes(app);
  registerWorkspaceRoutes(app);
}
