import { Router } from "express";
import { currentUser } from "../http.js";
import { searchSkills, TOP_SKILLS } from "../skills.js";

// Proxy for the skills.sh catalog behind auth: the frontend modal searches
// here instead of calling skills.sh directly (avoids CORS and keeps the
// external dependency in one place).
const router = Router();

router.get("/api/skills", async (req, res) => {
  await currentUser(req);
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
  try {
    // skills.sh search needs >= 2 characters; shorter queries show the
    // pinned popular list the modal opens with.
    const skills = query.length >= 2 ? await searchSkills(query) : TOP_SKILLS;
    return res.json({ skills, popular: query.length < 2 });
  } catch {
    return res.status(502).json({ error: "Could not search skills.sh. Try again shortly." });
  }
});

export default router;
