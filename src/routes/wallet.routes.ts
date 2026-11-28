import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { createDeposit, DepositError, DEPOSIT_LIMITS } from "../services/deposit.service";
import { AMOUNT_FILTER_RULES, decodeCursor, HISTORY_CURRENCIES, listTransactions, TRANSACTION_TYPES } from "../services/history.service";
import { getWalletByFirebaseUid } from "../services/wallet.service";
import { isoDateSchema } from "../validation/date";
import { AMOUNT_FORMAT, amountSchema, fiatCurrencySchema, idempotencyKeySchema } from "../validation/money";

export const walletRouter = Router();

walletRouter.use(requireAuth);

walletRouter.get("/", async (req, res) => {
  const wallet = await getWalletByFirebaseUid(req.user!.uid);

  if (!wallet) {
    res.status(404).json({ error: "Usuario no sincronizado, llama primero a POST /auth/sync" });
    return;
  }

  res.json({ wallet });
});

walletRouter.get("/balances/:currency", async (req, res) => {
  const wallet = await getWalletByFirebaseUid(req.user!.uid);

  if (!wallet) {
    res.status(404).json({ error: "Usuario no sincronizado, llama primero a POST /auth/sync" });
    return;
  }

  const code = req.params.currency.toUpperCase();
  const balance = wallet.balances.find((b) => b.currency_code === code);

  if (!balance) {
    res.status(404).json({ error: `Moneda no soportada: ${code}` });
    return;
  }

  res.json({ balance });
});

const depositSchema = z
  .strictObject(
    {
      currency: fiatCurrencySchema,
      amount: amountSchema,
      idempotency_key: idempotencyKeySchema,
    },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? "Solo se permiten los campos currency, amount e idempotency_key"
          : "El cuerpo debe ser un objeto JSON",
    }
  )
  .superRefine((data, ctx) => {
    if (!AMOUNT_FORMAT.test(data.amount)) {
      return;
    }
    const value = Number(data.amount);
    const max = DEPOSIT_LIMITS[data.currency].perDeposit;
    if (value < 1) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "El monto mínimo por carga es 1" });
    }
    if (value > max) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: `El monto máximo por carga es ${max.toLocaleString("es-AR")} ${data.currency}`,
      });
    }
  });

walletRouter.post("/deposit", validateBody(depositSchema), async (req, res) => {
  const { currency, amount, idempotency_key } = req.body as z.infer<typeof depositSchema>;

  try {
    const { deposit, replayed } = await createDeposit(req.user!.uid, currency, amount, idempotency_key);
    res.status(replayed ? 200 : 201).json({ deposit, replayed });
  } catch (err) {
    if (err instanceof DepositError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

const historyQuerySchema = z
  .object({
    type: z
      .string({ error: "type debe ser un texto" })
      .transform((value) => value.split(",").map((part) => part.trim().toUpperCase()))
      .pipe(z.array(z.enum(TRANSACTION_TYPES, { error: `type debe ser uno de: ${TRANSACTION_TYPES.join(", ")}` })))
      .optional(),
    currency: z
      .string({ error: "currency debe ser un texto" })
      .trim()
      .toUpperCase()
      .pipe(z.enum(HISTORY_CURRENCIES, { error: `currency debe ser una de: ${HISTORY_CURRENCIES.join(", ")}` }))
      .optional(),
    direction: z.enum(["sent", "received"], { error: "direction debe ser sent o received" }).optional(),
    flow: z.enum(["in", "out"], { error: "flow debe ser in o out" }).optional(),
    from: isoDateSchema("from").optional(),
    to: isoDateSchema("to").optional(),
    min_amount: z
      .string({ error: "min_amount debe ser un texto" })
      .trim()
      .regex(/^\d+(\.\d+)?$/, "min_amount debe ser un número mayor o igual a 0")
      .optional(),
    max_amount: z
      .string({ error: "max_amount debe ser un texto" })
      .trim()
      .regex(/^\d+(\.\d+)?$/, "max_amount debe ser un número mayor o igual a 0")
      .optional(),
    limit: z.coerce
      .number({ error: "limit debe ser un número" })
      .int("limit debe ser un número entero")
      .min(1, "limit debe ser mayor o igual a 1")
      .max(100, "limit no puede superar 100")
      .default(20),
    cursor: z.string({ error: "cursor debe ser un texto" }).optional(),
  })
  .superRefine((query, ctx) => {
    if (query.from && query.to && query.from > query.to) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "from no puede ser posterior a to" });
    }
    if (query.direction && query.type && !query.type.includes("TRANSFER")) {
      ctx.addIssue({ code: "custom", path: ["direction"], message: "direction solo aplica a transferencias: incluí TRANSFER en type" });
    }
    if (query.flow && query.direction) {
      ctx.addIssue({ code: "custom", path: ["flow"], message: "Usá flow o direction, no ambos" });
    }
    const hasAmount = query.min_amount !== undefined || query.max_amount !== undefined;
    if (hasAmount && !query.currency) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "Para filtrar por monto indicá la moneda (currency)" });
    }
    if (hasAmount && query.currency) {
      const rule = AMOUNT_FILTER_RULES[query.currency];
      for (const field of ["min_amount", "max_amount"] as const) {
        const value = query[field];
        if (value === undefined) {
          continue;
        }
        if ((value.split(".")[1] ?? "").length > rule.decimals) {
          ctx.addIssue({ code: "custom", path: [field], message: `${field} admite hasta ${rule.decimals} decimales en ${query.currency}` });
        }
        if (Number(value) > rule.max) {
          ctx.addIssue({ code: "custom", path: [field], message: `${field} no puede superar ${rule.max.toLocaleString("es-AR")} ${query.currency}` });
        }
      }
    }
    if (query.min_amount !== undefined && query.max_amount !== undefined && Number(query.min_amount) > Number(query.max_amount)) {
      ctx.addIssue({ code: "custom", path: ["min_amount"], message: "min_amount no puede ser mayor que max_amount" });
    }
  });

walletRouter.get("/transactions", async (req, res) => {
  const parsed = historyQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: "Datos inválidos",
      details: parsed.error.issues.map((issue) => ({ field: issue.path.map(String).join("."), message: issue.message })),
    });
    return;
  }

  const { type, cursor, min_amount, max_amount, ...filters } = parsed.data;
  const decoded = cursor ? decodeCursor(cursor) : undefined;

  if (decoded === null) {
    res.status(400).json({ error: "Datos inválidos", details: [{ field: "cursor", message: "cursor inválido" }] });
    return;
  }

  const page = await listTransactions(req.user!.uid, {
    ...filters,
    types: type,
    cursor: decoded,
    minAmount: min_amount,
    maxAmount: max_amount,
  });

  if (!page) {
    res.status(404).json({ error: "Usuario no sincronizado, llama primero a POST /auth/sync" });
    return;
  }

  res.json(page);
});
