import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { listUsers } from "../services/user.service";

export const usersRouter = Router();

usersRouter.use(requireAuth);

const listUsersQuery = z.object({
  page: z.coerce
    .number({ error: "page debe ser un número" })
    .int("page debe ser un número entero")
    .min(1, "page debe ser mayor o igual a 1")
    .default(1),
  limit: z.coerce
    .number({ error: "limit debe ser un número" })
    .int("limit debe ser un número entero")
    .min(1, "limit debe ser mayor o igual a 1")
    .max(100, "limit no puede superar 100")
    .default(10),
  search: z.string().trim().max(100, "search no puede superar los 100 caracteres").optional(),
});

usersRouter.get("/", async (req, res) => {
  const parsed = listUsersQuery.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: "Datos inválidos",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.map(String).join("."),
        message: issue.message,
      })),
    });
    return;
  }

  const { page, limit, search } = parsed.data;
  const { users, total } = await listUsers({ page, limit, search: search || undefined });

  res.json({
    users,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});
