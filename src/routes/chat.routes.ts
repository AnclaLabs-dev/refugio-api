import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { chat, ChatError, MAX_HISTORY_MESSAGES, MAX_MESSAGE_LENGTH } from "../services/chat.service";
import { RateLimiter } from "../utils/rate-limiter";

export const chatRouter = Router();

// El chat solo existe dentro de la cuenta del usuario: siempre requiere token
chatRouter.use(requireAuth);

const limiter = new RateLimiter(env.CHAT_MESSAGES_PER_MINUTE, env.CHAT_MESSAGES_PER_DAY);

const chatSchema = z.strictObject(
  {
    message: z
      .string({ error: "El mensaje es obligatorio" })
      .trim()
      .min(1, "El mensaje no puede estar vacío")
      .max(MAX_MESSAGE_LENGTH, `El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres`),
    history: z
      .array(
        z.strictObject({
          role: z.enum(["user", "assistant"], { error: "role debe ser user o assistant" }),
          content: z.string().trim().min(1).max(2000, "Cada mensaje del historial puede tener hasta 2000 caracteres"),
        }),
        { error: "history debe ser una lista de mensajes" }
      )
      .max(MAX_HISTORY_MESSAGES, `El historial puede tener hasta ${MAX_HISTORY_MESSAGES} mensajes`)
      .default([]),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? "Solo se permiten los campos message e history" : "El cuerpo debe ser un objeto JSON",
  }
);

chatRouter.post("/", validateBody(chatSchema), async (req, res) => {
  const retryAfter = limiter.hit(req.user!.uid);
  if (retryAfter > 0) {
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: `Enviaste demasiados mensajes. Probá de nuevo en ${retryAfter} segundos` });
    return;
  }

  const { message, history } = req.body as z.infer<typeof chatSchema>;
  try {
    const { reply, provider } = await chat(req.user!.uid, message, history);
    // Quién respondió: primary = Gemini, fallback = OpenRouter, guard = filtro previo (sin IA)
    res.setHeader("X-Chat-Provider", provider);
    res.json({ reply });
  } catch (err) {
    if (err instanceof ChatError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});
