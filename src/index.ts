import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { env } from "./config/env";
import { pool } from "./db/pool";
import { authRouter } from "./routes/auth.routes";
import { meRouter } from "./routes/me.routes";
import { walletRouter } from "./routes/wallet.routes";

const app = express();

const origins = env.FRONTEND_URL?.split(",").map(s => s.trim());
app.use(cors({ origin: origins ?? "http://localhost:5173", credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
     
app.use("/auth", authRouter);
app.use("/me", meRouter);
app.use("/wallet", walletRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
};
app.use(errorHandler);

const port = env.PORT;

pool.query("SELECT 1")
  .then(() => {
    app.listen(port, () => console.log(`Backend en puerto ${port}`));
  })
  .catch((err) => {
    console.error("No se pudo conectar a PostgreSQL:", err.message);
    process.exit(1);
  });
