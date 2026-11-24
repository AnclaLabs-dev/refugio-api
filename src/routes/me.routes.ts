import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { findUserByFirebaseUid, updateUserName } from "../services/user.service";

export const meRouter = Router();

meRouter.use(requireAuth);

const updateMeSchema = z.strictObject(
  {
    name: z
      .string({ error: "El nombre es obligatorio" })
      .trim()
      .min(1, "El nombre no puede estar vacío")
      .max(100, "El nombre no puede superar los 100 caracteres"),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "Solo se puede modificar el campo name"
        : "El cuerpo debe ser un objeto JSON",
  }
);

meRouter.get("/", async (req, res) => {
  const user = await findUserByFirebaseUid(req.user!.uid);

  if (!user) {
    res.status(404).json({ error: "Usuario no sincronizado, llama primero a POST /auth/sync" });
    return;
  }

  res.json({ user });
});

meRouter.patch("/", validateBody(updateMeSchema), async (req, res) => {
  const { name } = req.body as z.infer<typeof updateMeSchema>;
  const user = await updateUserName(req.user!.uid, name);

  if (!user) {
    res.status(404).json({ error: "Usuario no sincronizado, llama primero a POST /auth/sync" });
    return;
  }

  res.json({ user });
});
