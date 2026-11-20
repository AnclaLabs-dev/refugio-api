import express from "express";
import cors from "cors";

const app = express();

const origins = process.env.FRONTEND_URL?.split(",").map(s => s.trim());
app.use(cors({ origin: origins ?? "http://localhost:5173", credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Backend en puerto ${port}`));
