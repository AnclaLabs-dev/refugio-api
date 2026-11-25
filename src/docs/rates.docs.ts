/**
 * Documentación OpenAPI de las cotizaciones (/rates).
 * Se integra en openapi.ts. Mantener en sintonía con src/routes/rates.routes.ts.
 */

const exampleRates = [
  {
    pair: "USD/ARS",
    base: "USD",
    quote: "ARS",
    rate_type: "oficial",
    buy: "1405",
    sell: "1455",
    source: "dolarapi.com",
    fetched_at: "2026-11-24T17:30:12.000Z",
    stale: false,
  },
  {
    pair: "BTC/USD",
    base: "BTC",
    quote: "USD",
    rate_type: "spot",
    buy: "90125.42",
    sell: "90125.42",
    source: "coingecko.com",
    fetched_at: "2026-11-24T17:30:12.000Z",
    stale: false,
  },
  {
    pair: "USDT/USD",
    base: "USDT",
    quote: "USD",
    rate_type: "spot",
    buy: "1.0002",
    sell: "1.0002",
    source: "coingecko.com",
    fetched_at: "2026-11-24T17:30:12.000Z",
    stale: false,
  },
];

export const ratesTag = {
  name: "Cotizaciones",
  description: "Cotizaciones de referencia fiat (dólar oficial) y cripto (BTC, USDT), con historial diario",
};

export const ratesSchemas = {
  Rate: {
    type: "object",
    required: ["pair", "base", "quote", "rate_type", "buy", "sell", "source", "fetched_at", "stale"],
    properties: {
      pair: { type: "string", example: "USD/ARS" },
      base: { type: "string", description: "Moneda que se cotiza", example: "USD" },
      quote: { type: "string", description: "Moneda en la que se expresa el precio", example: "ARS" },
      rate_type: {
        type: "string",
        enum: ["oficial", "spot"],
        description: "`oficial`: dólar oficial (bancos autorizados por el BCRA). `spot`: precio de mercado cripto",
      },
      buy: { type: "string", description: "Precio de compra, como texto decimal para no perder precisión", example: "1405" },
      sell: { type: "string", description: "Precio de venta. En cripto (`spot`) es igual a `buy`", example: "1455" },
      source: { type: "string", enum: ["dolarapi.com", "coingecko.com"] },
      fetched_at: { type: "string", format: "date-time", description: "Momento en que el backend obtuvo la cotización" },
      stale: {
        type: "boolean",
        description: "`true` si la cotización es más vieja que `ttl_minutes` porque la fuente externa no respondió",
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
        "Devuelve **USD/ARS** (dólar oficial), **BTC/USD** y **USDT/USD**. Es **público**: no requiere token.",
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
                required: ["rates", "ttl_minutes"],
                properties: {
                  rates: { type: "array", items: { $ref: "#/components/schemas/Rate" } },
                  ttl_minutes: { type: "integer", description: "Vigencia de la caché en minutos", example: 10 },
                },
              },
              examples: {
                actualizadas: { summary: "Cotizaciones al día", value: { rates: exampleRates, ttl_minutes: 10 } },
                fuenteCaida: {
                  summary: "CoinGecko no respondió (cripto desactualizada)",
                  value: {
                    rates: [
                      exampleRates[0],
                      { ...exampleRates[1], fetched_at: "2026-11-24T16:05:40.000Z", stale: true },
                      { ...exampleRates[2], fetched_at: "2026-11-24T16:05:40.000Z", stale: true },
                    ],
                    ttl_minutes: 10,
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
        "Devuelve un valor por día: la última cotización registrada ese día (hora de Argentina). Es **público**.",
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
