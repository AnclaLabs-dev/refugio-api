import { pool } from "../db/pool";
import { Dec, formatDecimal } from "../utils/decimal";
import { getMarketRates, MarketRate, RatesUnavailableError } from "./rates.service";

/**
 * Resumen del patrimonio del usuario:
 * - Total valuado en USD y en ARS a precio de mercado (`mid`, sin spread).
 * - Composición por moneda (para el gráfico de dona).
 * - Evolución diaria de los últimos N días y su variación (para el gráfico de línea).
 *
 * La evolución se reconstruye con:
 * - Saldos: el saldo posterior a cada movimiento guardado en `transactions`
 *   (`from_balance_after` / `to_balance_after`). En las transferencias cada fila
 *   tiene un solo lado completo (enviado o recibido) y el otro en NULL, que se ignora.
 * - Precios: la cotización de cierre de cada día guardada en `rate_history`.
 *   Si un día no tiene cotización, se usa la del último día anterior que sí tenga.
 *
 * La variación se mide desde el primer día del período con patrimonio mayor a 0 hasta hoy.
 * Incluye cargas, conversiones y transferencias (enviadas y recibidas):
 * es el cambio del patrimonio, no un rendimiento puro.
 */

const ARGENTINA_TIMEZONE = "America/Argentina/Buenos_Aires";
const DAY_MS = 24 * 60 * 60 * 1000;

type Pair = "USD/ARS" | "BTC/USD" | "USDT/USD";
type Prices = Partial<Record<Pair, Dec>>;

export interface CompositionItem {
  currency: string;
  name: string;
  type: "fiat" | "crypto";
  amount: string;
  value_usd: string;
  value_ars: string;
  percent: string;
}

export interface HistoryPoint {
  date: string;
  total_usd: string | null;
  total_ars: string | null;
}

export interface Variation {
  from_date: string;
  to_date: string;
  start_usd: string;
  end_usd: string;
  change_usd: string;
  change_percent_usd: string | null;
  start_ars: string;
  end_ars: string;
  change_ars: string;
  change_percent_ars: string | null;
}

export interface WalletSummary {
  total_usd: string;
  total_ars: string;
  valued_at: Date;
  stale: boolean;
  composition: CompositionItem[];
  days: number;
  variation: Variation | null;
  history: HistoryPoint[];
}

export class SummaryError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- Valuación ----------

/** Precio en USD de 1 unidad de la moneda, o null si falta la cotización. */
function usdPerUnit(currency: string, prices: Prices): Dec | null {
  switch (currency) {
    case "USD":
      return new Dec(1);
    case "ARS":
      return prices["USD/ARS"] ? new Dec(1).div(prices["USD/ARS"]) : null;
    case "BTC":
      return prices["BTC/USD"] ?? null;
    case "USDT":
      return prices["USDT/USD"] ?? null;
    default:
      return null;
  }
}

/** Valúa un conjunto de saldos. Devuelve null si falta alguna cotización necesaria. */
function valuate(balances: Map<string, Dec>, prices: Prices): { usd: Dec; ars: Dec } | null {
  const usdArs = prices["USD/ARS"];
  if (!usdArs) return null;

  let usd = new Dec(0);
  for (const [currency, amount] of balances) {
    if (amount.isZero()) continue;
    const price = usdPerUnit(currency, prices);
    if (!price) return null;
    usd = usd.plus(amount.times(price));
  }
  return { usd, ars: usd.times(usdArs) };
}

/** Montos de dinero siempre con 2 decimales ("1455.50"). */
const money = (value: Dec) => value.toDecimalPlaces(2, Dec.ROUND_HALF_UP).toFixed(2);

function percentChange(start: Dec, end: Dec): string | null {
  return start.isZero() ? null : money(end.minus(start).div(start).times(100));
}

function todayInArgentina(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: ARGENTINA_TIMEZONE });
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// ---------- Datos ----------

interface BalanceRow {
  wallet_id: string;
  currency_code: string;
  name: string;
  type: "fiat" | "crypto";
  amount: string;
}

async function loadBalances(firebaseUid: string): Promise<BalanceRow[]> {
  const result = await pool.query<BalanceRow>(
    `SELECT w.id AS wallet_id, b.currency_code, c.name, c.type, b.amount::text AS amount
     FROM users u
     JOIN wallets w ON w.user_id = u.id
     JOIN balances b ON b.wallet_id = w.id
     JOIN currencies c ON c.code = b.currency_code
     WHERE u.firebase_uid = $1`,
    [firebaseUid]
  );
  return result.rows;
}

interface BalanceEvent {
  day: string;
  currency: string;
  balance_after: string;
}

/** Saldo resultante después de cada movimiento, por moneda, en orden cronológico. */
async function loadBalanceEvents(walletId: string): Promise<BalanceEvent[]> {
  const result = await pool.query<BalanceEvent>(
    `SELECT to_char((t.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day, e.currency, e.balance_after::text AS balance_after
     FROM transactions t
     CROSS JOIN LATERAL (VALUES
       (t.from_currency, t.from_balance_after, 0),
       (t.to_currency, t.to_balance_after, 1)
     ) AS e(currency, balance_after, ord)
     WHERE t.wallet_id = $1 AND e.currency IS NOT NULL AND e.balance_after IS NOT NULL
     ORDER BY t.created_at, e.ord`,
    [walletId, ARGENTINA_TIMEZONE]
  );
  return result.rows;
}

interface PriceRow {
  date: string;
  pair: Pair;
  mid: string;
}

/** Precio de mercado de cierre de cada día (punto medio entre compra y venta). */
async function loadPriceHistory(until: string): Promise<PriceRow[]> {
  const result = await pool.query<PriceRow>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, base_currency || '/' || quote_currency AS pair,
            ((buy + sell) / 2)::text AS mid
     FROM rate_history
     WHERE date <= $1::date
       AND (base_currency, quote_currency, rate_type::text) IN (('USD', 'ARS', 'oficial'), ('BTC', 'USD', 'spot'), ('USDT', 'USD', 'spot'))
     ORDER BY date`,
    [until]
  );
  return result.rows;
}

// ---------- Resumen ----------

export async function getWalletSummary(firebaseUid: string, days: number): Promise<WalletSummary> {
  let market: MarketRate[];
  try {
    market = await getMarketRates();
  } catch (err) {
    if (err instanceof RatesUnavailableError) throw new SummaryError(503, err.message);
    throw err;
  }

  const rows = await loadBalances(firebaseUid);
  if (rows.length === 0) {
    throw new SummaryError(404, "Usuario no sincronizado, llama primero a POST /auth/sync");
  }

  // Precios actuales (mercado, sin spread)
  const currentPrices: Prices = {};
  for (const r of market) {
    if (r.pair === "USD/ARS" || r.pair === "BTC/USD" || r.pair === "USDT/USD") currentPrices[r.pair] = r.mid;
  }

  const currentBalances = new Map(rows.map((r) => [r.currency_code, new Dec(r.amount)]));
  const current = valuate(currentBalances, currentPrices);
  if (!current) {
    throw new SummaryError(503, "Cotizaciones no disponibles por el momento, intentá de nuevo en unos minutos");
  }

  // Composición
  const usdArs = currentPrices["USD/ARS"]!;
  const composition: CompositionItem[] = rows
    .map((r) => {
      const amount = new Dec(r.amount);
      const valueUsd = amount.times(usdPerUnit(r.currency_code, currentPrices)!);
      return { row: r, amount, valueUsd };
    })
    .sort((a, b) => b.valueUsd.comparedTo(a.valueUsd))
    .map(({ row, amount, valueUsd }) => ({
      currency: row.currency_code,
      name: row.name,
      type: row.type,
      amount: amount.toString(),
      value_usd: money(valueUsd),
      value_ars: money(valueUsd.times(usdArs)),
      percent: current.usd.isZero() ? "0.00" : money(valueUsd.div(current.usd).times(100)),
    }));

  // Evolución diaria
  const today = todayInArgentina();
  const firstDay = addDays(today, -(days - 1));
  const [events, priceRows] = await Promise.all([loadBalanceEvents(rows[0].wallet_id), loadPriceHistory(today)]);

  const balances = new Map<string, Dec>();
  const prices: Prices = {};
  let eventIndex = 0;
  let priceIndex = 0;
  const history: HistoryPoint[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(firstDay, i);

    while (eventIndex < events.length && events[eventIndex].day <= date) {
      const e = events[eventIndex++];
      balances.set(e.currency, new Dec(e.balance_after));
    }
    while (priceIndex < priceRows.length && priceRows[priceIndex].date <= date) {
      const p = priceRows[priceIndex++];
      prices[p.pair] = new Dec(p.mid);
    }

    // Hoy se usan los saldos y precios actuales, para que coincida con el total
    const value = date === today ? current : valuate(balances, prices);
    history.push({ date, total_usd: value ? money(value.usd) : null, total_ars: value ? money(value.ars) : null });
  }

  // Variación: desde el primer día del período con patrimonio (> 0) hasta hoy
  const first = history.find((h) => h.total_usd !== null && !new Dec(h.total_usd).isZero());
  const last = history[history.length - 1];
  let variation: Variation | null = null;
  if (first && last.total_usd !== null && first.date !== last.date) {
    const startUsd = new Dec(first.total_usd!);
    const startArs = new Dec(first.total_ars!);
    const endUsd = new Dec(last.total_usd);
    const endArs = new Dec(last.total_ars!);
    variation = {
      from_date: first.date,
      to_date: last.date,
      start_usd: money(startUsd),
      end_usd: money(endUsd),
      change_usd: money(endUsd.minus(startUsd)),
      change_percent_usd: percentChange(startUsd, endUsd),
      start_ars: money(startArs),
      end_ars: money(endArs),
      change_ars: money(endArs.minus(startArs)),
      change_percent_ars: percentChange(startArs, endArs),
    };
  }

  const used = market.filter((r) => !r.derived);
  return {
    total_usd: money(current.usd),
    total_ars: money(current.ars),
    valued_at: used.reduce((min, r) => (r.fetched_at < min ? r.fetched_at : min), used[0].fetched_at),
    stale: used.some((r) => r.stale),
    composition,
    days,
    variation,
    history,
  };
}
