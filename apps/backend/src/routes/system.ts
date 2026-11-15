import { Router } from "express";

const router = Router();

router.get("/api/health", (_req, res) => res.json({ ok: true }));
router.get("/", (_req, res) => res.json({ name: "OpenDevin API", ok: true }));

export default router;
