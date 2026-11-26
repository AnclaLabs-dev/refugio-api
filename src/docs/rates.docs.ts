/**
 * Documentación OpenAPI de las cotizaciones (/rates).
 * Se integra en openapi.ts. Mantener en sintonía con src/routes/rates.routes.ts.
 */

const fetched = "2026-11-26T17:30:12.000Z";

const exampleRates = [
  { pair: "USD/ARS", base: "USD", quote: "ARS", rate_type: "oficial", mid: "1430", buy: "1405", sell: "1455", spread: "0.035", source: "dolarapi.com", fetched_at: fetched, stale: false, derived: false },
  { pair: "BTC/USD", base: "BTC", quote: "USD", rate_type: "spot", mid: "90125.42", buy: "89674.7929", sell: "90576.0471", spread: "0.01", source: "coingecko.com", fetched_at: fetched, stale: false, derived: false },
  { pair: "USDT/USD", base: "USDT", quote: "USD", rate_type: "spot", mid: "1.0002", buy: "0.995199", sell: "1.005201", spread: "0.01", source: "coingecko.com", fetched_at: fetched, stale: false, derived: false },
  { pair: "BTC/ARS", base: "BTC", quote: "ARS", rate_type: "spot", mid: "128879350.6", buy: "125993084.0245", sell: "131788148.5305", spread: "0.045", source: "coingecko.com + dolarapi.com", fetched_at: fetched, stale: false, derived: true },
  { pair: "USDT/ARS", base: "USDT", quote: "ARS", rate_type: "spot", mid: "1430.286", buy: "1398.254595", sell: "1462.567455", spread: "0.045", source: "coingecko.com + dolarapi.com", fetched_at: fetched, stale: false, derived: true },
];

export const ratesTag = {
  name: "Cotizaciones",
  description: "Cotizaciones de referencia fiat (dólar oficial) y cripto (BTC, USDT), con historial diario",
};

export const ratesSchemas = {
  Rate: {
    type: "object",
    required: ["pair", "base", "quote", "rate_type", "mid", "buy", "sell", "spread", "source", "fetched_at", "stale", "derived"],
    properties: {
      pair: { type: "string", example: "USD/ARS" },
      base: { type: "string", description: "Moneda que se cotiza", example: "USD" },
      quote: { type: "string", description: "Moneda en la que se expresa el precio", example: "ARS" },
      rate_type: {
        type: "string",
        enum: ["oficial", "spot"],
        description: "`oficial`: dólar oficial (bancos autorizados por el BCRA). `spot`: precio de mercado cripto",
      },
      mid: { type: "string", description: "Precio de mercado (punto medio entre compra y venta)", example: "1430" },
      buy: {
        type: "string",
        description: "Precio al que Refugio te **compra** la moneda base (lo que recibís si vendés). Texto decimal para no perder precisión",
        example: "1405",
      },
      sell: { type: "string", description: "Precio al que Refugio te **vende** la moneda base (lo que pagás si comprás)", example: "1455" },
      spread: {
        type: "string",
        description: "Diferencia entre venta y compra sobre el precio medio (0.01 = 1%). Dólar oficial: spread real de los bancos. Cripto: spread de Refugio (`crypto_spread`)",
        example: "0.035",
      },
      source: { type: "string", example: "dolarapi.com" },
      fetched_at: { type: "string", format: "date-time", description: "Momento en que el backend obtuvo la cotización" },
      stale: {
        type: "boolean",
        description: "`true` si la cotización es más vieja que `ttl_minutes` porque la fuente externa no respondió",
      },
      derived: {
        type: "boolean",
        description: "`true` en los pares calculados: BTC/ARS y USDT/ARS = cripto/USD × USD/ARS oficial",
      },
    },
  },
  RateHistoryPoint: {
    type: "object",
    required: ["date", "buy", "sell", "source"],
    properties: {
      date: { type: "string", format: "date", example: "2026-11-24" },
      buy: { type: "string", example: "1405" },
      sell: { type: "string", example: "1455" },
      source: { type: "string", example: "dolarapi.com" },
    },
  },
};

export const ratesPaths = {
  "/rates": {
    get: {
      tags: ["Cotizaciones"],
      operationId: "getRates",
      summary: "Obtener las cotizaciones actuales",
      description: [
        "Devuelve **USD/ARS** (dólar oficial), **BTC/USD**, **USDT/USD** y los pares calculados **BTC/ARS** y **USDT/ARS**. Es **público**: no requiere token.",
        "",
        "**Spread (transparencia de tasas):**",
        "- Dólar oficial: compra y venta reales de los bancos.",
        "- Cripto: CoinGecko da un solo precio de mercado (`mid`); Refugio aplica su spread (`crypto_spread`, 1%): `buy = mid × 0,995` y `sell = mid × 1,005`.",
        "- Pares en pesos: se combinan los dos tramos (cripto → USD → ARS) con sus spreads.",
        "",
        "**Cómo funciona la caché:**",
        "- Las cotizaciones se guardan en la base de datos (`exchange_rates`).",
        "- Si tienen menos de `ttl_minutes` (10 por defecto), se devuelven directamente.",
        "- Si vencieron, el backend consulta **DolarApi** (fiat) y **CoinGecko** (cripto), las actualiza y guarda el valor del día en el historial.",
        "- Si una fuente externa no responde, se devuelve la última cotización guardada con `stale: true`.",
      ].join("\n"),
      security: [],
      responses: {
        "200": {
          description: "Cotizaciones actuales",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["rates", "ttl_minutes", "crypto_spread"],
                properties: {
                  rates: { type: "array", items: { $ref: "#/components/schemas/Rate" } },
                  ttl_minutes: { type: "integer", description: "Vigencia de la caché en minutos", example: 10 },
                  crypto_spread: { type: "string", description: "Spread total que aplica Refugio a cripto (0.01 = 1%)", example: "0.01" },
                },
              },
              examples: {
                actualizadas: { summary: "Cotizaciones al día", value: { rates: exampleRates, ttl_minutes: 10, crypto_spread: "0.01" } },
                fuenteCaida: {
                  summary: "CoinGecko no respondió (cripto desactualizada)",
                  value: {
                    rates: [
                      exampleRates[0],
                      ...exampleRates.slice(1).map((r) => ({ ...r, fetched_at: "2026-11-26T16:05:40.000Z", stale: true })),
                    ],
                    ttl_minutes: 10,
                    crypto_spread: "0.01",
                  },
                },
              },
            },
          },
        },
        "503": {
          description: "No hay cotizaciones guardadas y las fuentes externas no respondieron",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: { error: "Cotizaciones no disponibles por el momento, intentá de nuevo en unos minutos" },
            },
          },
        },
        "500": { $ref: "#/components/responses/InternalError" },
      },
    },
  },
  "/rates/history": {
    get: {
      tags: ["Cotizaciones"],
      operationId: "getRateHistory",
      summary: "Historial diario de un par (comparador histórico)",
      description: [
        "Devuelve un valor por día: la última cotización de **mercado** registrada ese día (hora de Argentina, sin el spread de Refugio). Es **público**.",
        "",
        "- Pares disponibles: `USD/ARS`, `BTC/USD`, `USDT/USD`.",
        "- Si no se envían fechas, devuelve los **últimos 30 días**.",
        "- Rango máximo: 366 días.",
        "- Los días sin datos no aparecen en la lista. El historial se completa a medida que se consultan las cotizaciones.",
      ].join("\n"),
      security: [],
      parameters: [
        {
          name: "base",
          in: "query",
          required: true,
          description: "Moneda que se cotiza",
          schema: { type: "string", enum: ["USD", "BTC", "USDT"] },
          example: "USD",
        },
        {
          name: "quote",
          in: "query",
          required: true,
          description: "Moneda en la que se expresa el precio",
          schema: { type: "string", enum: ["ARS", "USD"] },
          example: "ARS",
        },
        {
          name: "from",
          in: "query",
          required: false,
          description: "Fecha inicial (YYYY-MM-DD). Por defecto, 30 días antes de `to`",
          schema: { type: "string", format: "date" },
          example: "2026-11-01",
        },
        {
          name: "to",
          in: "query",
          required: false,
          description: "Fecha final (YYYY-MM-DD). Por defecto, hoy",
          schema: { type: "string", format: "date" },
          example: "2026-11-24",
        },
      ],
      responses: {
        "200": {
          description: "Historial del par",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["pair", "base", "quote", "rate_type", "from", "to", "history"],
                properties: {
                  pair: { type: "string", example: "USD/ARS" },
                  base: { type: "string", example: "USD" },
                  quote: { type: "string", example: "ARS" },
                  rate_type: { type: "string", enum: ["oficial", "spot"] },
                  from: { type: "string", format: "date" },
                  to: { type: "string", format: "date" },
                  history: { type: "array", items: { $ref: "#/components/schemas/RateHistoryPoint" } },
                },
              },
              example: {
                pair: "USD/ARS",
                base: "USD",
                quote: "ARS",
                rate_type: "oficial",
                from: "2026-11-22",
                to: "2026-11-24",
                history: [
                  { date: "2026-11-22", buy: "1400", sell: "1450", source: "dolarapi.com" },
                  { date: "2026-11-23", buy: "1400", sell: "1450", source: "dolarapi.com" },
                  { date: "2026-11-24", buy: "1405", sell: "1455", source: "dolarapi.com" },
                ],
              },
            },
          },
        },
        "400": {
          description: "Par no soportado o fechas inválidas",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationError" },
              examples: {
                parInvalido: {
                  summary: "Par no soportado",
                  value: {
                    error: "Datos inválidos",
                    details: [{ field: "base", message: "Par no soportado. Pares disponibles: USD/ARS, BTC/USD, USDT/USD" }],
                  },
                },
                fechas: {
                  summary: "from posterior a to",
                  value: { error: "Datos inválidos", details: [{ field: "from", message: "from no puede ser posterior a to" }] },
                },
              },
            },
          },
        },
        "500": { $ref: "#/components/responses/InternalError" },
      },
    },
  },
};
