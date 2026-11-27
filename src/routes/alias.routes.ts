import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { aliasSchema, findPublicProfileByAlias } from "../services/alias.service";

export const aliasRouter = Router();

aliasRouter.use(requireAuth);

aliasRouter.get("/:alias", async (req, res) => {
  const parsed = aliasSchema.safeParse(req.params.alias);

  if (!parsed.success) {
    res.status(400).json({
      error: "Datos inválidos",
      details: parsed.error.issues.map((issue) => ({ field: "alias", message: issue.message })),
    });
    return;
  }

  const profile = await findPublicProfileByAlias(parsed.data);

  if (!profile) {
    res.status(404).json({ error: "No existe ningún usuario con ese alias" });
    return;
  }

  res.json({ profile });
});
