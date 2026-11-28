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
  // Chatbot (proveedor compatible con la API de OpenAI; por defecto Google Gemini)
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta/openai"),
  AI_MODEL: z.string().min(1).default("gemini-3.8-flash"),
  // Cuánto "razona" el modelo principal antes de responder (low = más rápido). Vacío = valor por defecto del modelo
  AI_REASONING_EFFORT: z.enum(["low", "medium", "high"]).optional(),
  // Tiempo máximo de espera del proveedor principal antes de pasar al respaldo
  AI_PRIMARY_TIMEOUT_MS: z.coerce.number().int().min(3000).max(60000).default(15000),
  // Respaldo (fallback): se usa solo si el proveedor principal falla. Por defecto OpenRouter
  AI_FALLBACK_API_KEY: z.string().optional(),
  AI_FALLBACK_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  // Lista separada por comas; OpenRouter prueba en orden. "openrouter/free" elige modelos gratis con salida JSON
  AI_FALLBACK_MODELS: z.string().min(1).default("openrouter/free"),
  CHAT_MESSAGES_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  CHAT_MESSAGES_PER_DAY: z.coerce.number().int().min(1).default(200),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Variables de entorno inválidas:", parsed.error.issues);
  process.exit(1);
}

export const env = parsed.data;
