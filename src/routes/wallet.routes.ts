import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
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
