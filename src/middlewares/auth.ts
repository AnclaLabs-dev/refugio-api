import type { NextFunction, Request, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import { firebaseAuth } from "../config/firebase";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Falta el token de autenticación" });
    return;
  }

  const token = header.slice(7);

  let decoded: DecodedIdToken;
  try {
    decoded = await firebaseAuth.verifyIdToken(token);
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
    return;
  }

  req.user = { uid: decoded.uid, email: decoded.email };
  next();
}
