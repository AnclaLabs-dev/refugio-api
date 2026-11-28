/**
 * Filtro previo del chatbot: rechaza ataques obvios ANTES de llamar a la IA.
 * - No depende de que el modelo "obedezca": funciona siempre igual.
 * - Ahorra cupo del proveedor.
 * Es deliberadamente acotado (solo patrones claros) para no bloquear consultas legítimas;
 * el resto de los casos los resuelven el prompt y el control de `in_scope`.
 */

export type GuardCategory = "injection" | "inappropriate" | "third_party" | "off_topic";

/** Minúsculas y sin tildes, para que "Olvidá" y "olvida" coincidan. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

const INJECTION_PATTERNS: RegExp[] = [
  // Inglés
  /\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|all|your|system)\b.{0,20}\b(instructions?|prompts?|rules?|context)\b/,
  /\b(system|developer) (prompt|message|instructions?)\b/,
  /\b(jailbreak|dan mode|developer mode|god mode)\b/,
  /\byou are (now|no longer)\b/,
  // Español
  /\b(olvida|ignora|omiti|saltea|desactiva|borra)\b.{0,30}\b(instrucciones|reglas|configuracion|prompt|indicaciones|restricciones)\b/,
  /\b(prompt|mensaje|instrucciones) (de|del) sistema\b/,
  /\b(modo|actua como|hace de cuenta que sos|ahora sos)\b.{0,20}\b(desarrollador|administrador|sin restricciones|sin filtros|libre)\b/,
  /\b(mostrame|decime|revela|copia|repeti)\b.{0,25}\b(tu prompt|tus instrucciones|tu configuracion|tus reglas)\b/,
];

const INAPPROPRIATE_PATTERNS: RegExp[] = [
  /\bhablame (sucio|caliente|sexy)\b/,
  /\bsexy\b/,
  /\b(romantic[oa]s?|romance|coquete[ao]|coqueteame|flirt\w*|piropos?|seduc\w*|enamor\w*)\b/,
  /\b(romantic|flirty?)\b/,
  /\btalk dirty\b/,
  /\b(sexo|sexual|porno|pornografia|desnud[oa]s?|erotic[oa]|nudes?|sexting|cachond[oa]|calentame)\b/,
  /\b(sex|porn|naked|horny)\b/,
];

/** Pedidos de datos personales de otra persona (no bloquea "transferir a otro usuario"). */
const THIRD_PARTY_PATTERNS: RegExp[] = [
  /\b(emails?|mails?|correos?|saldos?|datos|dni|telefonos?|direccion(es)?|contrasenas?|claves?|movimientos|patrimonio)\b.{0,15}\b(de|del) (otro|otra|otros|otras|algun|alguna|cualquier) (usuarios?|usuarias?|personas?|clientes?)\b/,
  /\b(emails?|mails?|correos?|saldos?|datos|dni|telefonos?) (de|del) (todos|todas) (los|las) (usuarios?|clientes?)\b/,
  /\b(other|another) (users?|customers?)'?s? (emails?|balances?|data)\b/,
];

/** Pedidos de entretenimiento claramente fuera de tema (el resto lo resuelve el modelo). */
const OFF_TOPIC_PATTERNS: RegExp[] = [/\b(chistes?|jokes?|adivinanzas?|poemas?|poesia|cancion(es)?|cuentos?)\b/];

export function checkMessage(message: string): GuardCategory | null {
  const text = normalize(message);
  if (INJECTION_PATTERNS.some((p) => p.test(text))) return "injection";
  if (INAPPROPRIATE_PATTERNS.some((p) => p.test(text))) return "inappropriate";
  if (THIRD_PARTY_PATTERNS.some((p) => p.test(text))) return "third_party";
  if (OFF_TOPIC_PATTERNS.some((p) => p.test(text))) return "off_topic";
  return null;
}

export const STANDARD_SUGGESTIONS = ["¿Cuál es mi saldo total?", "¿A cuánto está el dólar hoy?", "¿Cómo convierto pesos a dólares?"];

export const GUARD_REPLIES: Record<GuardCategory | "out_of_scope", string> = {
  injection: "No puedo cambiar mis instrucciones ni mi forma de trabajar. Soy Refu, el asistente financiero de Refugio: te ayudo con tus saldos, movimientos, cotizaciones y finanzas personales.",
  inappropriate: "Ese tipo de contenido está fuera de lo que puedo hacer. Te ayudo con tus finanzas y con el uso de Refugio.",
  third_party: "No tengo acceso a datos de otros usuarios y no puedo compartirlos. Solo puedo ayudarte con tu propia cuenta.",
  off_topic: "Solo puedo ayudarte con finanzas personales y con el uso de Refugio. ¿Querés que revisemos tus saldos o las cotizaciones?",
  out_of_scope: "Solo puedo ayudarte con finanzas personales y con el uso de Refugio. ¿Querés que revisemos tus saldos o las cotizaciones?",
};
