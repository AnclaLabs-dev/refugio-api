import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import {
  createExchange,
  CURRENCY_DECIMALS,
  EXCHANGE_CURRENCIES,
  ExchangeError,
  quoteExchange,
} from "../services/exchange.service";

export const exchangeRouter = Router();

exchangeRouter.use(requireAuth);

const currencyField = (field: string) =>
  z
    .string({ error: `${field} es obligatorio` })
    .trim()
    .toUpperCase()
    .pipe(z.enum(EXCHANGE_CURRENCIES, { error: `${field} debe ser ARS, USD, USDT o BTC` }));

const amountField = z
  .union([z.string(), z.number()], { error: "El monto es obligatorio" })
  .transform(String)
  .pipe(z.string().trim().regex(/^\d+(\.\d+)?$/, "El monto debe ser un número positivo"));

const baseFields = {
  from: currencyField("from"),
  to: currencyField("to"),
  amount: amountField,
};

/** Validaciones comunes: monedas distintas, monto > 0 y decimales según la moneda de origen. */
function checkExchange(data: { from: string; to: string; amount: string }, ctx: z.RefinementCtx) {
  if (data.from === data.to) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "La moneda de destino debe ser distinta a la de origen" });
  }
  const decimals = CURRENCY_DECIMALS[data.from as keyof typeof CURRENCY_DECIMALS];
  const [, fraction = ""] = data.amount.split(".");
  if (decimals !== undefined && fraction.length > decimals) {
    ctx.addIssue({ code: "custom", path: ["amount"], message: `${data.from} admite hasta ${decimals} decimales` });
  }
  if (Number(data.amount) <= 0) {
    ctx.addIssue({ code: "custom", path: ["amount"], message: "El monto debe ser mayor a 0" });
  }
}

const unknownKeys = (allowed: string) => ({
  error: (issue: { code: string }) =>
    issue.code === "unrecognized_keys" ? `Solo se permiten los campos ${allowed}` : "El cuerpo debe ser un objeto JSON",
});

const quoteSchema = z.strictObject(baseFields, unknownKeys("from, to y amount")).superRefine(checkExchange);

const exchangeSchema = z
  .strictObject(
    {
      ...baseFields,
      idempotency_key: z
        .string({ error: "La idempotency_key es obligatoria" })
        .trim()
        .min(8, "La idempotency_key debe tener al menos 8 caracteres")
        .max(64, "La idempotency_key no puede superar los 64 caracteres"),
    },
    unknownKeys("from, to, amount e idempotency_key")
  )
  .superRefine(checkExchange);

function handleError(err: unknown, res: import("express").Response) {
  if (err instanceof ExchangeError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

exchangeRouter.post("/quote", validateBody(quoteSchema), async (req, res) => {
  const { from, to, amount } = req.body as z.infer<typeof quoteSchema>;
  try {
    res.json({ quote: await quoteExchange(from, to, amount) });
  } catch (err) {
    handleError(err, res);
  }
});

exchangeRouter.post("/", validateBody(exchangeSchema), async (req, res) => {
  const { from, to, amount, idempotency_key } = req.body as z.infer<typeof exchangeSchema>;
  try {
    const { exchange, replayed } = await createExchange(req.user!.uid, from, to, amount, idempotency_key);
    res.status(replayed ? 200 : 201).json({ exchange, replayed });
  } catch (err) {
    handleError(err, res);
  }
});
