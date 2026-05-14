import { Router } from "express";

const router: Router = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

export default router;
