import { z } from "zod";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { Dec, formatDecimal } from "../utils/decimal";

/**
 * Cotizaciones con caché en la base de datos.
 *
 * - El front SIEMPRE consulta a nuestro back (GET /rates). Nunca llama a las APIs externas.
 * - Si las cotizaciones guardadas en `exchange_rates` tienen menos de RATES_TTL_MINUTES,
 *   se devuelven directamente (rápido y sin gastar llamadas).
 * - Si vencieron, se consultan DolarApi (fiat) y CoinGecko (cripto), se actualiza
 *   `exchange_rates` y se guarda el valor del día en `rate_history` (comparador histórico).
 * - Si una API externa falla, se devuelve la última cotización guardada marcada como `stale`.
 *
 * Spread:
 * - Dólar oficial: se usa la compra/venta real de los bancos (ya trae spread).
 * - Cripto: CoinGecko da un solo precio de mercado (`mid`). Refugio aplica un spread propio
 *   (CRYPTO_SPREAD, 1% por defecto): compra = mid × (1 − spread/2), venta = mid × (1 + spread/2).
 * - En la base se guarda siempre el precio de mercado; el spread se aplica al leer.
 *
 * Convención (igual que en bancos y casas de cambio):
 * - `buy`  = precio al que Refugio te COMPRA la moneda base (lo que recibís si vendés).
 * - `sell` = precio al que Refugio te VENDE la moneda base (lo que pagás si comprás).
 */

export type RateType = "oficial" | "spot";

export interface RatePair {
  base: string;
  quote: string;
  rate_type: RateType;
}

/** Pares de monedas que maneja Refugio. */
export const SUPPORTED_PAIRS: readonly RatePair[] = [
  { base: "USD", quote: "ARS", rate_type: "oficial" },
  { base: "BTC", quote: "USD", rate_type: "spot" },
  { base: "USDT", quote: "USD", rate_type: "spot" },
];

const DOLARAPI_URL = "https://dolarapi.com/v1/dolares/oficial";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,tether&vs_currencies=usd&precision=full";
const ARGENTINA_TIMEZONE = "America/Argentina/Buenos_Aires";
const EXTERNAL_TIMEOUT_MS = 5000;
/** Tiempo mínimo entre dos consultas externas (evita consultas duplicadas y martillar una API caída). */
const MIN_REFRESH_INTERVAL_MS = 60_000;

/** Cotización tal como está guardada en la base (precio de mercado, sin spread propio). */
interface StoredRate {
  pair: string;
  base: string;
  quote: string;
  rate_type: RateType;
  buy: string;
  sell: string;
  source: string;
  fetched_at: Date;
  stale: boolean;
}

/** Cotización lista para operar: con spread aplicado y valores decimales exactos. */
export interface MarketRate {
  pair: string;
  base: string;
  quote: string;
  rate_type: RateType;
  mid: Dec;
  buy: Dec;
  sell: Dec;
  spread: Dec;
  source: string;
  fetched_at: Date;
  stale: boolean;
  derived: boolean;
}

/** Cotización tal como la devuelve GET /rates. */
export interface Rate {
  pair: string;
  base: string;
  quote: string;
  rate_type: RateType;
  mid: string;
  buy: string;
  sell: string;
  spread: string;
  source: string;
  fetched_at: Date;
  stale: boolean;
  derived: boolean;
}

export interface RateHistoryPoint {
  date: string;
  buy: string;
  sell: string;
  source: string;
}

interface FetchedRate {
  base: string;
  quote: string;
  rate_type: RateType;
  buy: number;
  sell: number;
  source: string;
}

export class RatesUnavailableError extends Error {}

// ---------- Fuentes externas ----------

const dolarApiSchema = z.object({
  compra: z.number().positive(),
  venta: z.number().positive(),
});

const coinGeckoSchema = z.object({
  bitcoin: z.object({ usd: z.number().positive() }),
  tether: z.object({ usd: z.number().positive() }),
});

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`${url} respondió ${res.status}`);
  }
  return res.json();
}

/** Dólar oficial (USD/ARS) desde DolarApi. */
async function fetchFiatRates(): Promise<FetchedRate[]> {
  const data = dolarApiSchema.parse(await getJson(DOLARAPI_URL));
  return [{ base: "USD", quote: "ARS", rate_type: "oficial", buy: data.compra, sell: data.venta, source: "dolarapi.com" }];
}

/** BTC/USD y USDT/USD desde CoinGecko. Precio de mercado: compra = venta. */
async function fetchCryptoRates(): Promise<FetchedRate[]> {
  const headers: Record<string, string> = {};
  if (env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = env.COINGECKO_API_KEY;
  }
  const data = coinGeckoSchema.parse(await getJson(COINGECKO_URL, headers));
  return [
    { base: "BTC", quote: "USD", rate_type: "spot", buy: data.bitcoin.usd, sell: data.bitcoin.usd, source: "coingecko.com" },
    { base: "USDT", quote: "USD", rate_type: "spot", buy: data.tether.usd, sell: data.tether.usd, source: "coingecko.com" },
  ];
}

// ---------- Guardado ----------

async function saveRates(rates: FetchedRate[]): Promise<void> {
  if (rates.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rates) {
      const params = [r.base, r.quote, r.rate_type, r.buy, r.sell, r.source];

      await client.query(
        `INSERT INTO exchange_rates (base_currency, quote_currency, rate_type, buy, sell, source, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (base_currency, quote_currency, rate_type)
         DO UPDATE SET buy = EXCLUDED.buy, sell = EXCLUDED.sell, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at`,
        params
      );

      // Un registro por día (hora de Argentina). Se va pisando durante el día,
      // así que al terminar el día queda la última cotización (cierre).
      await client.query(
        `INSERT INTO rate_history (date, base_currency, quote_currency, rate_type, buy, sell, source)
         VALUES ((now() AT TIME ZONE $7)::date, $1, $2, $3, $4, $5, $6)
         ON CONFLICT (date, base_currency, quote_currency, rate_type)
         DO UPDATE SET buy = EXCLUDED.buy, sell = EXCLUDED.sell, source = EXCLUDED.source`,
        [...params, ARGENTINA_TIMEZONE]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Caché ----------

let refreshInFlight: Promise<void> | null = null;
let lastRefreshStartedAt = 0;

/** Consulta las APIs externas y guarda lo que haya respondido bien. */
async function refreshRates(): Promise<void> {
  const results = await Promise.allSettled([fetchFiatRates(), fetchCryptoRates()]);

  const ok = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

  for (const f of failures) {
    console.error("No se pudo actualizar una cotización:", f.reason instanceof Error ? f.reason.message : f.reason);
  }

  await saveRates(ok);
}

async function readStoredRates(): Promise<StoredRate[]> {
  const result = await pool.query<StoredRate>(
    `SELECT base_currency || '/' || quote_currency AS pair,
            base_currency AS base, quote_currency AS quote, rate_type,
            trim_scale(buy)::text AS buy, trim_scale(sell)::text AS sell,
            source, fetched_at,
            fetched_at < now() - make_interval(mins => $1) AS stale
     FROM exchange_rates`,
    [env.RATES_TTL_MINUTES]
  );

  // Devolver en el orden definido en SUPPORTED_PAIRS
  return SUPPORTED_PAIRS.flatMap((p) =>
    result.rows.filter((r) => r.base === p.base && r.quote === p.quote && r.rate_type === p.rate_type)
  );
}

function needsRefresh(rates: StoredRate[]): boolean {
  return rates.length < SUPPORTED_PAIRS.length || rates.some((r) => r.stale);
}

/**
 * Se asegura de que las cotizaciones estén frescas.
 * - Si varios usuarios piden a la vez, se hace UNA sola consulta externa (refreshInFlight).
 * - Nunca se consulta afuera más de una vez por minuto (si una fuente está caída, no se la martilla).
 */
async function ensureFreshRates(): Promise<void> {
  const current = await readStoredRates();
  if (!needsRefresh(current)) return;

  if (!refreshInFlight) {
    if (Date.now() - lastRefreshStartedAt < MIN_REFRESH_INTERVAL_MS) return;
    lastRefreshStartedAt = Date.now();
    refreshInFlight = refreshRates().finally(() => {
      refreshInFlight = null;
    });
  }

  try {
    await refreshInFlight;
  } catch (err) {
    // Si falla el guardado, se siguen devolviendo los datos que ya había
    console.error("Error al refrescar cotizaciones:", err instanceof Error ? err.message : err);
  }
}

// ---------- Spread y pares derivados ----------

function applySpread(r: StoredRate): MarketRate {
  const buy = new Dec(r.buy);
  const sell = new Dec(r.sell);
  const base = { pair: r.pair, base: r.base, quote: r.quote, rate_type: r.rate_type, source: r.source, fetched_at: r.fetched_at, stale: r.stale, derived: false };

  if (r.rate_type === "spot") {
    // Cripto: CoinGecko da un único precio de mercado → aplicamos el spread de Refugio
    const mid = buy;
    const spread = new Dec(env.CRYPTO_SPREAD);
    const half = spread.div(2);
    return { ...base, mid, buy: mid.times(Dec.sub(1, half)), sell: mid.times(Dec.add(1, half)), spread };
  }

  // Dólar oficial: compra y venta reales de los bancos
  const mid = buy.plus(sell).div(2);
  return { ...base, mid, buy, sell, spread: sell.minus(buy).div(mid) };
}

/** Cripto en pesos: BTC/ARS = BTC/USD × USD/ARS oficial (con los spreads de cada tramo). */
function derivePair(crypto: MarketRate, usdArs: MarketRate): MarketRate {
  const mid = crypto.mid.times(usdArs.mid);
  const buy = crypto.buy.times(usdArs.buy);
  const sell = crypto.sell.times(usdArs.sell);
  return {
    pair: `${crypto.base}/ARS`,
    base: crypto.base,
    quote: "ARS",
    rate_type: "spot",
    mid,
    buy,
    sell,
    spread: sell.minus(buy).div(mid),
    source: `${crypto.source} + ${usdArs.source}`,
    fetched_at: crypto.fetched_at < usdArs.fetched_at ? crypto.fetched_at : usdArs.fetched_at,
    stale: crypto.stale || usdArs.stale,
    derived: true,
  };
}

function toPublicRate(r: MarketRate): Rate {
  return {
    pair: r.pair,
    base: r.base,
    quote: r.quote,
    rate_type: r.rate_type,
    mid: formatDecimal(r.mid, 8),
    buy: formatDecimal(r.buy, 8),
    sell: formatDecimal(r.sell, 8),
    spread: formatDecimal(r.spread, 4),
    source: r.source,
    fetched_at: r.fetched_at,
    stale: r.stale,
    derived: r.derived,
  };
}

// ---------- API pública del servicio ----------

/**
 * Cotizaciones de mercado (USD/ARS, BTC/USD, USDT/USD) con el spread aplicado.
 * Las usa también el servicio de conversiones.
 */
export async function getMarketRates(): Promise<MarketRate[]> {
  await ensureFreshRates();
  const stored = await readStoredRates();

  if (stored.length === 0) {
    throw new RatesUnavailableError("Cotizaciones no disponibles por el momento, intentá de nuevo en unos minutos");
  }

  return stored.map(applySpread);
}

export async function getCurrentRates(): Promise<{ rates: Rate[]; ttl_minutes: number; crypto_spread: string }> {
  const market = await getMarketRates();

  const usdArs = market.find((r) => r.pair === "USD/ARS");
  const derived = usdArs
    ? market.filter((r) => r.rate_type === "spot" && r.quote === "USD").map((r) => derivePair(r, usdArs))
    : [];

  return {
    rates: [...market, ...derived].map(toPublicRate),
    ttl_minutes: env.RATES_TTL_MINUTES,
    crypto_spread: formatDecimal(new Dec(env.CRYPTO_SPREAD), 4),
  };
}

export function findPair(base: string, quote: string): RatePair | undefined {
  return SUPPORTED_PAIRS.find((p) => p.base === base && p.quote === quote);
}

export async function getRateHistory(pair: RatePair, from: string, to: string): Promise<RateHistoryPoint[]> {
  // Asegura que el día de hoy tenga su registro (no bloquea si las APIs externas fallan)
  await ensureFreshRates();

  const result = await pool.query<RateHistoryPoint>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date,
            trim_scale(buy)::text AS buy, trim_scale(sell)::text AS sell, source
     FROM rate_history
     WHERE base_currency = $1 AND quote_currency = $2 AND rate_type = $3
       AND date BETWEEN $4::date AND $5::date
     ORDER BY date`,
    [pair.base, pair.quote, pair.rate_type, from, to]
  );
  return result.rows;
}
