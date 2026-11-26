import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { getWalletSummary, SummaryError } from "../services/summary.service";

// Se monta en /wallet/summary (antes que el router de /wallet en index.ts)
export const summaryRouter = Router();

summaryRouter.use(requireAuth);

const summaryQuery = z.object({
  days: z.coerce
    .number({ error: "days debe ser un número" })
    .int("days debe ser un número entero")
    .min(7, "days debe ser al menos 7")
    .max(365, "days no puede superar 365")
    .default(30),
});

summaryRouter.get("/", async (req, res) => {
  const parsed = summaryQuery.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: "Datos inválidos",
      details: parsed.error.issues.map((issue) => ({ field: issue.path.map(String).join("."), message: issue.message })),
    });
    return;
  }

  try {
    res.json({ summary: await getWalletSummary(req.user!.uid, parsed.data.days) });
  } catch (err) {
    if (err instanceof SummaryError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});
