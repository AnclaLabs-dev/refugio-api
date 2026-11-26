import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { pool } from "./db/pool";
import { authRouter } from "./routes/auth.routes";
import { meRouter } from "./routes/me.routes";
import { walletRouter } from "./routes/wallet.routes";
import { usersRouter } from "./routes/users.routes";
import { ratesRouter } from "./routes/rates.routes";
import { exchangeRouter } from "./routes/exchange.routes";
import { summaryRouter } from "./routes/summary.routes";
import { openApiSpec } from "./docs/openapi";

const app = express();

const origins = env.FRONTEND_URL?.split(",").map(s => s.trim());
app.use(cors({ origin: origins ?? "http://localhost:5173", credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
     
app.use("/auth", authRouter);
app.use("/me", meRouter);
app.use("/wallet/summary", summaryRouter);
app.use("/wallet", walletRouter);
app.use("/users", usersRouter);
app.use("/rates", ratesRouter);
app.use("/exchange", exchangeRouter);

// Documentación de la API (Swagger)
app.get("/api-docs.json", (_req, res) => {
  res.json(openApiSpec);
});
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: "Refugio API · Documentación",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      docExpansion: "list",
      filter: true,
    },
  })
);

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
