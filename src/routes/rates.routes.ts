import { Router } from "express";
import { z } from "zod";
import { findPair, getCurrentRates, getRateHistory, RatesUnavailableError, SUPPORTED_PAIRS } from "../services/rates.service";

export const ratesRouter = Router();

// Rutas públicas: las cotizaciones de referencia se muestran incluso antes del login.

ratesRouter.get("/", async (_req, res) => {
  try {
    res.json(await getCurrentRates());
  } catch (err) {
    if (err instanceof RatesUnavailableError) {
      res.status(503).json({ error: err.message });
      return;
    }
    throw err;
  }
});

const MAX_RANGE_DAYS = 366;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function todayInArgentina(): string {
  // en-CA formatea como YYYY-MM-DD
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const isoDate = (field: string) =>
  z
    .string()
    .regex(DATE_FORMAT, `${field} debe tener el formato YYYY-MM-DD`)
    .refine((v) => {
      const time = Date.parse(`${v}T00:00:00Z`);
      // Descarta fechas inexistentes como 2026-02-30
      return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === v;
    }, `${field} no es una fecha válida`);

const pairsList = SUPPORTED_PAIRS.map((p) => `${p.base}/${p.quote}`).join(", ");

const historyQuery = z
  .object({
    base: z.string({ error: "base es obligatorio" }).trim().toUpperCase(),
    quote: z.string({ error: "quote es obligatorio" }).trim().toUpperCase(),
    from: isoDate("from").optional(),
    to: isoDate("to").optional(),
  })
  .superRefine((q, ctx) => {
    if (!findPair(q.base, q.quote)) {
      ctx.addIssue({ code: "custom", path: ["base"], message: `Par no soportado. Pares disponibles: ${pairsList}` });
    }
  });

ratesRouter.get("/history", async (req, res) => {
  const parsed = historyQuery.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: "Datos inválidos",
      details: parsed.error.issues.map((issue) => ({ field: issue.path.map(String).join("."), message: issue.message })),
    });
    return;
  }

  const { base, quote } = parsed.data;
  const to = parsed.data.to ?? todayInArgentina();
  const from = parsed.data.from ?? addDays(to, -30);

  const details: { field: string; message: string }[] = [];
  if (from > to) {
    details.push({ field: "from", message: "from no puede ser posterior a to" });
  } else if ((Date.parse(to) - Date.parse(from)) / DAY_MS > MAX_RANGE_DAYS) {
    details.push({ field: "from", message: `El rango máximo es de ${MAX_RANGE_DAYS} días` });
  }
  if (details.length > 0) {
    res.status(400).json({ error: "Datos inválidos", details });
    return;
  }

  const pair = findPair(base, quote)!;
  const history = await getRateHistory(pair, from, to);

  res.json({ pair: `${base}/${quote}`, base, quote, rate_type: pair.rate_type, from, to, history });
});
