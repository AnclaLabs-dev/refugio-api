import { cert, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { env } from "./env";

let serviceAccount: ServiceAccount;
try {
  serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
} catch {
  console.error("FIREBASE_SERVICE_ACCOUNT no es un JSON válido");
  process.exit(1);
}

const firebaseApp = initializeApp({ credential: cert(serviceAccount) });

export const firebaseAuth = getAuth(firebaseApp);
