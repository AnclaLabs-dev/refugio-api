import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { aliasSchema, AliasCooldownError, AliasTakenError } from "../services/alias.service";
import { findUserByFirebaseUid, updateProfile } from "../services/user.service";

export const meRouter = Router();

meRouter.use(requireAuth);

const updateMeSchema = z
  .strictObject(
    {
      name: z
        .string({ error: "El nombre debe ser un texto" })
        .trim()
        .min(1, "El nombre no puede estar vacío")
        .max(100, "El nombre no puede superar los 100 caracteres")
        .optional(),
      alias: aliasSchema.optional(),
    },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? "Solo se pueden modificar los campos name y alias"
          : "El cuerpo debe ser un objeto JSON",
    }
  )
  .refine((data) => data.name !== undefined || data.alias !== undefined, {
    message: "Enviá al menos name o alias",
  });

meRouter.get("/", async (req, res) => {
  const user = await findUserByFirebaseUid(req.user!.uid);

  if (!user) {
    res.status(404).json({ error: "Usuario no sincronizado, llama primero a POST /auth/sync" });
    return;
  }

  res.json({ user });
});

meRouter.patch("/", validateBody(updateMeSchema), async (req, res) => {
  const changes = req.body as z.infer<typeof updateMeSchema>;

  try {
    const user = await updateProfile(req.user!.uid, changes);

    if (!user) {
      res.status(404).json({ error: "Usuario no sincronizado, llama primero a POST /auth/sync" });
      return;
    }

    res.json({ user });
  } catch (err) {
    if (err instanceof AliasTakenError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof AliasCooldownError) {
      res.status(422).json({ error: err.message });
      return;
    }
    throw err;
  }
});
