// Genera un ID token de Firebase para probar la API desde Swagger.
// Uso:  npm run token -- <email> <password>
// Requiere FIREBASE_WEB_API_KEY en el .env (es la "apiKey" pública de la config web de Firebase).
import "dotenv/config";

const [email, password] = process.argv.slice(2);
const apiKey = process.env.FIREBASE_WEB_API_KEY;

if (!email || !password) {
  console.error("Uso: npm run token -- <email> <password>");
  process.exit(1);
}
if (!apiKey) {
  console.error("Falta FIREBASE_WEB_API_KEY en el archivo .env");
  process.exit(1);
}

const res = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }
);
const data = await res.json();

if (!res.ok) {
  console.error("No se pudo iniciar sesión:", data.error?.message ?? data);
  process.exit(1);
}

console.log("\nID token (válido por 1 hora). Copialo y pegalo en Authorize de Swagger:\n");
console.log(data.idToken);
