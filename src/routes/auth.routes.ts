import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { syncUser } from "../services/user.service";

export const authRouter = Router();

const syncSchema = z
  .object({
    name: z.string().trim().max(100, "El nombre no puede superar los 100 caracteres").optional(),
  })
  .optional();

authRouter.post("/sync", requireAuth, validateBody(syncSchema), async (req, res) => {
  const { uid, email } = req.user!;

  if (!email) {
    res.status(400).json({ error: "La cuenta no tiene un email asociado" });
    return;
  }

  const body = req.body as z.infer<typeof syncSchema>;
  const name = body?.name || null;

  const { user, created } = await syncUser(uid, email, name);
  res.status(created ? 201 : 200).json({ user, created });
});
