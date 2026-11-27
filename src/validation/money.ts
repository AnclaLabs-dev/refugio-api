import { z } from "zod";

export const AMOUNT_FORMAT = /^\d+(\.\d{1,2})?$/;

export const fiatCurrencySchema = z.enum(["ARS", "USD"], { error: "La moneda debe ser ARS o USD" });

export const amountSchema = z
  .union([z.string(), z.number()], { error: "El monto es obligatorio" })
  .transform(String)
  .pipe(z.string().trim().regex(AMOUNT_FORMAT, "El monto debe ser un número positivo con hasta 2 decimales"));

export const idempotencyKeySchema = z
  .string({ error: "La idempotency_key es obligatoria" })
  .trim()
  .min(8, "La idempotency_key debe tener al menos 8 caracteres")
  .max(64, "La idempotency_key no puede superar los 64 caracteres");
