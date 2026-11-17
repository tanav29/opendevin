import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { currentUser } from "../http.js";
import { resolveChatModel } from "../config.js";
import { githubHeaders, githubTokenForUser } from "../github.js";

const router = Router();
router.get("/api/settings", async (req, res) => {
  const { user } = await currentUser(req);
  const settings = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { defaultModel: true },
  });
  res.json({ defaultModel: settings.defaultModel, systemModel: resolveChatModel().modelId });
});
router.put("/api/settings", async (req, res) => {
  const { user } = await currentUser(req);
  const model = req.body?.defaultModel;
  if (
    typeof model !== "string" ||
    (model !== "" && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(model)) ||
    model.length > 200
  ) {
    return res
      .status(400)
      .json({ error: "Enter an OpenRouter model ID in provider/model format, or leave it blank." });
  }
  await prisma.user.update({ where: { id: user.id }, data: { defaultModel: model } });
  return res.json({ defaultModel: model });
});
router.get("/api/settings/usage", async (req, res) => {
  const { user } = await currentUser(req);
  const [projects, sessions] = await Promise.all([
    prisma.project.count({ where: { userId: user.id } }),
    prisma.projectSession.findMany({
      where: { project: { userId: user.id } },
      select: { usage: true },
    }),
  ]);
  let recordedSessions = 0,
    tokens = 0;
  for (const session of sessions) {
    try {
      const usage = JSON.parse(session.usage);
      if (
        typeof usage.totalTokens === "number" &&
        Number.isFinite(usage.totalTokens) &&
        usage.totalTokens >= 0
      ) {
        tokens += usage.totalTokens;
        recordedSessions++;
      }
    } catch {
      /* Invalid usage is unknown, not zero. */
    }
  }
  res.json({
    projects,
    sessions: sessions.length,
    recordedSessions,
    tokens: recordedSessions ? tokens : null,
  });
});
router.get("/api/settings/github", async (req, res) => {
  const { user } = await currentUser(req);
  const token = await githubTokenForUser(user.id);
  if (!token) return res.json({ status: "disconnected" });
  try {
    const response = await fetch("https://api.github.com/user", { headers: githubHeaders(token) });
    return res.json({
      status: response.ok ? "connected" : response.status === 401 ? "disconnected" : "unknown",
    });
  } catch {
    return res.json({ status: "unknown" });
  }
});
export default router;
