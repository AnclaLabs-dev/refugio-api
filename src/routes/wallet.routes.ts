import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { createDeposit, DepositError, DEPOSIT_LIMITS } from "../services/deposit.service";
import { getWalletByFirebaseUid } from "../services/wallet.service";

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

const AMOUNT_FORMAT = /^\d+(\.\d{1,2})?$/;

const depositSchema = z
  .strictObject(
    {
      currency: z.enum(["ARS", "USD"], { error: "La moneda debe ser ARS o USD" }),
      amount: z
        .union([z.string(), z.number()], { error: "El monto es obligatorio" })
        .transform(String)
        .pipe(z.string().trim().regex(AMOUNT_FORMAT, "El monto debe ser un número positivo con hasta 2 decimales")),
      idempotency_key: z
        .string({ error: "La idempotency_key es obligatoria" })
        .trim()
        .min(8, "La idempotency_key debe tener al menos 8 caracteres")
        .max(64, "La idempotency_key no puede superar los 64 caracteres"),
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
