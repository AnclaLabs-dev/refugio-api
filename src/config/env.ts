import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, "Falta DATABASE_URL"),
  FIREBASE_SERVICE_ACCOUNT: z.string().min(1, "Falta FIREBASE_SERVICE_ACCOUNT"),
  FRONTEND_URL: z.string().optional(),
  COINGECKO_API_KEY: z.string().optional(),
  RATES_TTL_MINUTES: z.coerce.number().int().min(1).default(10),
  CRYPTO_SPREAD: z.coerce.number().min(0).max(0.1).default(0.01),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Variables de entorno inválidas:", parsed.error.issues);
  process.exit(1);
}

export const env = parsed.data;
