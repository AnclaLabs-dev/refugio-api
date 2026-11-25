import { z } from "zod";
import { pool } from "../db/pool";
import { env } from "../config/env";

/**
 * Cotizaciones con caché en la base de datos.
 *
 * - El front SIEMPRE consulta a nuestro back (GET /rates). Nunca llama a las APIs externas.
 * - Si las cotizaciones guardadas en `exchange_rates` tienen menos de RATES_TTL_MINUTES,
 *   se devuelven directamente (rápido y sin gastar llamadas).
 * - Si vencieron, se consultan DolarApi (fiat) y CoinGecko (cripto), se actualiza
 *   `exchange_rates` y se guarda el valor del día en `rate_history` (comparador histórico).
 * - Si una API externa falla, se devuelve la última cotización guardada marcada como `stale`.
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

export interface Rate {
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

async function readStoredRates(): Promise<Rate[]> {
  const result = await pool.query<Rate>(
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

function needsRefresh(rates: Rate[]): boolean {
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

// ---------- API pública del servicio ----------

export async function getCurrentRates(): Promise<{ rates: Rate[]; ttl_minutes: number }> {
  await ensureFreshRates();
  const rates = await readStoredRates();

  if (rates.length === 0) {
    throw new RatesUnavailableError("Cotizaciones no disponibles por el momento, intentá de nuevo en unos minutos");
  }

  return { rates, ttl_minutes: env.RATES_TTL_MINUTES };
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
