import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { aliasSchema } from "../services/alias.service";
import { createTransfer, TRANSFER_DAILY_LIMITS, TransferError } from "../services/transfer.service";
import { AMOUNT_FORMAT, amountSchema, fiatCurrencySchema, idempotencyKeySchema } from "../validation/money";

export const transferRouter = Router();

transferRouter.use(requireAuth);

const transferSchema = z
  .strictObject(
    {
      to_alias: aliasSchema,
      currency: fiatCurrencySchema,
      amount: amountSchema,
      idempotency_key: idempotencyKeySchema,
    },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? "Solo se permiten los campos to_alias, currency, amount e idempotency_key"
          : "El cuerpo debe ser un objeto JSON",
    }
  )
  .superRefine((data, ctx) => {
    if (!AMOUNT_FORMAT.test(data.amount)) {
      return;
    }
    const value = Number(data.amount);
    const max = TRANSFER_DAILY_LIMITS[data.currency];
    if (value <= 0) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "El monto debe ser mayor a 0" });
    }
    if (value > max) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: `El monto máximo por transferencia es ${max.toLocaleString("es-AR")} ${data.currency}`,
      });
    }
  });

transferRouter.post("/", validateBody(transferSchema), async (req, res) => {
  const { to_alias, currency, amount, idempotency_key } = req.body as z.infer<typeof transferSchema>;

  try {
    const { transfer, replayed } = await createTransfer(req.user!.uid, to_alias, currency, amount, idempotency_key);
    res.status(replayed ? 200 : 201).json({ transfer, replayed });
  } catch (err) {
    if (err instanceof TransferError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});
