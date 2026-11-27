import { pool } from "../db/pool";
import { Dec, formatDecimal } from "../utils/decimal";
import { getMarketRates, MarketRate, RatesUnavailableError } from "./rates.service";

/**
 * Conversiones entre ARS, USD, USDT y BTC.
 *
 * Todas las conversiones pasan por el dólar (USD) como moneda puente:
 *   monto destino = monto origen × (valor en USD de lo que entregás) / (costo en USD de lo que recibís)
 *
 * - Lo que ENTREGÁS se valúa al precio de compra de Refugio (`buy`).
 * - Lo que RECIBÍS se cobra al precio de venta de Refugio (`sell`).
 * - La diferencia contra el precio de mercado (`mid`) es el spread que paga el usuario,
 *   y queda guardado en `transactions.spread` (transparencia de tasas).
 */

export const EXCHANGE_CURRENCIES = ["ARS", "USD", "USDT", "BTC"] as const;
export type ExchangeCurrency = (typeof EXCHANGE_CURRENCIES)[number];

export const CURRENCY_DECIMALS: Record<ExchangeCurrency, number> = { ARS: 2, USD: 2, USDT: 6, BTC: 8 };

/** Jerarquía para clasificar la operación: subir = comprar, bajar = vender, cripto ↔ cripto = intercambio. */
const CURRENCY_RANK: Record<ExchangeCurrency, number> = { ARS: 0, USD: 1, USDT: 2, BTC: 2 };

type TransactionType = "BUY" | "SELL" | "EXCHANGE";

export interface ExchangeQuote {
  from_currency: ExchangeCurrency;
  from_amount: string;
  to_currency: ExchangeCurrency;
  to_amount: string;
  /** Unidades de `to_currency` que recibís por cada unidad de `from_currency`. */
  rate: string;
  /** Lo que recibirías al precio de mercado, sin spread. */
  mid_to_amount: string;
  /** Costo total de la operación respecto del precio de mercado (0.005 = 0,5%). */
  spread: string;
  type: TransactionType;
  rate_type: "oficial" | "spot";
  rate_source: string;
  rate_fetched_at: Date;
  rates_used: { pair: string; buy: string; sell: string; mid: string }[];
}

export interface Exchange {
  id: string;
  type: TransactionType;
  from_currency: ExchangeCurrency;
  from_amount: string;
  from_balance_after: string;
  to_currency: ExchangeCurrency;
  to_amount: string;
  to_balance_after: string;
  rate: string;
  rate_type: "oficial" | "spot";
  rate_side: "buy" | "sell" | null;
  spread: string;
  rate_source: string;
  rate_fetched_at: Date;
  idempotency_key: string;
  created_at: Date;
}

export class ExchangeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- Cálculo ----------

function findRate(rates: MarketRate[], pair: string): MarketRate {
  const rate = rates.find((r) => r.pair === pair);
  if (!rate) {
    throw new ExchangeError(503, `Cotización ${pair} no disponible por el momento, intentá de nuevo en unos minutos`);
  }
  return rate;
}

/** Pares de mercado necesarios para valuar una moneda en USD. */
function pairFor(currency: ExchangeCurrency): string | null {
  if (currency === "USD") return null;
  if (currency === "ARS") return "USD/ARS";
  return `${currency}/USD`;
}

/** Cuántos USD vale 1 unidad de `currency` según el lado de la operación. */
function usdValue(currency: ExchangeCurrency, side: "give" | "receive" | "mid", rates: MarketRate[]): Dec {
  if (currency === "USD") return new Dec(1);

  if (currency === "ARS") {
    const usdArs = findRate(rates, "USD/ARS");
    // Entregar pesos = comprar dólares (pagás `sell`). Recibir pesos = vender dólares (te pagan `buy`).
    const arsPerUsd = side === "give" ? usdArs.sell : side === "receive" ? usdArs.buy : usdArs.mid;
    return new Dec(1).div(arsPerUsd);
  }

  const crypto = findRate(rates, `${currency}/USD`);
  // Entregar cripto = Refugio te la compra (`buy`). Recibir cripto = Refugio te la vende (`sell`).
  return side === "give" ? crypto.buy : side === "receive" ? crypto.sell : crypto.mid;
}

function classify(from: ExchangeCurrency, to: ExchangeCurrency): { type: TransactionType; rate_side: "buy" | "sell" | null } {
  const diff = CURRENCY_RANK[to] - CURRENCY_RANK[from];
  if (diff > 0) return { type: "BUY", rate_side: "buy" };
  if (diff < 0) return { type: "SELL", rate_side: "sell" };
  return { type: "EXCHANGE", rate_side: null };
}

interface Calculation {
  quote: ExchangeQuote;
  stale: boolean;
}

function calculate(from: ExchangeCurrency, to: ExchangeCurrency, amountText: string, rates: MarketRate[]): Calculation {
  const amount = new Dec(amountText);

  const raw = amount.times(usdValue(from, "give", rates)).div(usdValue(to, "receive", rates));
  const atMid = amount.times(usdValue(from, "mid", rates)).div(usdValue(to, "mid", rates));

  // Se redondea hacia abajo a los decimales de la moneda destino (nunca se acredita de más)
  const toAmount = raw.toDecimalPlaces(CURRENCY_DECIMALS[to], Dec.ROUND_DOWN);
  if (toAmount.lte(0)) {
    throw new ExchangeError(422, `El monto es demasiado chico: recibirías 0 ${to}`);
  }

  const used = [pairFor(from), pairFor(to)]
    .filter((p): p is string => p !== null)
    .filter((p, i, all) => all.indexOf(p) === i)
    .map((p) => findRate(rates, p));

  const sources = [...new Set(used.map((r) => r.source))].sort();
  const oldest = used.reduce((min, r) => (r.fetched_at < min ? r.fetched_at : min), used[0].fetched_at);
  const { type } = classify(from, to);

  return {
    stale: used.some((r) => r.stale),
    quote: {
      from_currency: from,
      from_amount: formatDecimal(amount, CURRENCY_DECIMALS[from]),
      to_currency: to,
      to_amount: formatDecimal(toAmount, CURRENCY_DECIMALS[to]),
      rate: formatDecimal(toAmount.div(amount), 10),
      mid_to_amount: formatDecimal(atMid, CURRENCY_DECIMALS[to]),
      spread: formatDecimal(Dec.sub(1, raw.div(atMid)), 4),
      type,
      rate_type: used.every((r) => r.rate_type === "oficial") ? "oficial" : "spot",
      rate_source: sources.join(" + "),
      rate_fetched_at: oldest,
      rates_used: used.map((r) => ({
        pair: r.pair,
        buy: formatDecimal(r.buy, 8),
        sell: formatDecimal(r.sell, 8),
        mid: formatDecimal(r.mid, 8),
      })),
    },
  };
}

async function loadRates(): Promise<MarketRate[]> {
  try {
    return await getMarketRates();
  } catch (err) {
    if (err instanceof RatesUnavailableError) {
      throw new ExchangeError(503, err.message);
    }
    throw err;
  }
}

// ---------- API pública del servicio ----------

/** Cotización previa: calcula cuánto recibirías, sin mover dinero. */
export async function quoteExchange(from: ExchangeCurrency, to: ExchangeCurrency, amount: string): Promise<ExchangeQuote & { stale: boolean }> {
  const { quote, stale } = calculate(from, to, amount, await loadRates());
  return { ...quote, stale };
}

const EXCHANGE_COLUMNS = `id, type, from_currency,
  trim_scale(from_amount)::text AS from_amount, trim_scale(from_balance_after)::text AS from_balance_after,
  to_currency, trim_scale(to_amount)::text AS to_amount, trim_scale(to_balance_after)::text AS to_balance_after,
  trim_scale(rate)::text AS rate, rate_type, rate_side, trim_scale(spread)::text AS spread,
  rate_source, rate_fetched_at, idempotency_key, created_at`;

export async function createExchange(
  firebaseUid: string,
  from: ExchangeCurrency,
  to: ExchangeCurrency,
  amount: string,
  idempotencyKey: string
): Promise<{ exchange: Exchange; replayed: boolean }> {
  // 1) Cotizaciones ANTES de abrir la transacción (no bloquear saldos mientras se consultan APIs externas)
  const rates = await loadRates();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 2) Bloquear los dos saldos del usuario. Mismo orden que las transferencias
    //    (wallet_id, currency_code) para que nunca se bloqueen entre sí (deadlock)
    const locked = await client.query<{ wallet_id: string; currency_code: string; amount: string }>(
      `SELECT b.wallet_id, b.currency_code, b.amount::text AS amount
       FROM balances b
       JOIN wallets w ON w.id = b.wallet_id
       JOIN users u ON u.id = w.user_id
       WHERE u.firebase_uid = $1 AND b.currency_code IN ($2, $3)
       ORDER BY b.wallet_id, b.currency_code
       FOR UPDATE OF b`,
      [firebaseUid, from, to]
    );

    const walletId = locked.rows[0]?.wallet_id;
    if (!walletId) {
      throw new ExchangeError(404, "Usuario no sincronizado, llama primero a POST /auth/sync");
    }

    // 3) Idempotencia: si ya se procesó esta operación, devolver la original
    const previous = await client.query<Exchange & { wallet_id: string }>(
      `SELECT ${EXCHANGE_COLUMNS}, wallet_id FROM transactions WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    const existing = previous.rows[0];
    if (existing) {
      if (existing.wallet_id !== walletId || !["BUY", "SELL", "EXCHANGE"].includes(existing.type)) {
        throw new ExchangeError(409, "La idempotency_key ya fue usada en otra operación");
      }
      await client.query("ROLLBACK");
      const { wallet_id, ...exchange } = existing;
      return { exchange, replayed: true };
    }

    // 4) Calcular con cotizaciones vigentes (no se opera con precios viejos)
    const { quote, stale } = calculate(from, to, amount, rates);
    if (stale) {
      throw new ExchangeError(503, "Las cotizaciones están desactualizadas, intentá de nuevo en unos minutos");
    }

    // 5) Saldo suficiente
    const fromBalance = locked.rows.find((r) => r.currency_code === from);
    if (!fromBalance || new Dec(fromBalance.amount).lt(quote.from_amount)) {
      const available = fromBalance ? formatDecimal(new Dec(fromBalance.amount), CURRENCY_DECIMALS[from]) : "0";
      throw new ExchangeError(422, `Saldo insuficiente: tenés ${available} ${from}`);
    }

    // 6) Mover saldos
    const debited = await client.query<{ amount: string }>(
      `UPDATE balances SET amount = amount - $1::numeric, updated_at = now()
       WHERE wallet_id = $2 AND currency_code = $3
       RETURNING amount::text`,
      [quote.from_amount, walletId, from]
    );
    const credited = await client.query<{ amount: string }>(
      `UPDATE balances SET amount = amount + $1::numeric, updated_at = now()
       WHERE wallet_id = $2 AND currency_code = $3
       RETURNING amount::text`,
      [quote.to_amount, walletId, to]
    );

    // 7) Registrar la operación con la cotización y el spread exactos
    const { rate_side } = classify(from, to);
    const inserted = await client.query<Exchange>(
      `INSERT INTO transactions (
         wallet_id, type, from_currency, from_amount, from_balance_after,
         to_currency, to_amount, to_balance_after,
         rate, rate_type, rate_side, spread, rate_source, rate_fetched_at, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING ${EXCHANGE_COLUMNS}`,
      [
        walletId,
        quote.type,
        from,
        quote.from_amount,
        debited.rows[0].amount,
        to,
        quote.to_amount,
        credited.rows[0].amount,
        quote.rate,
        quote.rate_type,
        rate_side,
        quote.spread,
        quote.rate_source,
        quote.rate_fetched_at,
        idempotencyKey,
      ]
    );

    await client.query("COMMIT");
    return { exchange: inserted.rows[0], replayed: false };
  } catch (err) {
    await client.query("ROLLBACK");
    if ((err as { code?: string }).code === "23505") {
      throw new ExchangeError(409, "La idempotency_key ya fue usada en otra operación");
    }
    throw err;
  } finally {
    client.release();
  }
}
