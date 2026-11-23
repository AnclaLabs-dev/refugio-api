import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { syncUser } from "../services/user.service";

export const authRouter = Router();

authRouter.post("/sync", requireAuth, async (req, res) => {
  const { uid, email } = req.user!;

  if (!email) {
    res.status(400).json({ error: "La cuenta no tiene un email asociado" });
    return;
  }

  const { user, created } = await syncUser(uid, email);
  res.status(created ? 201 : 200).json({ user, created });
});
