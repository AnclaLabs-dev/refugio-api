/**
 * Documentación OpenAPI de las conversiones (/exchange).
 * Se integra en openapi.ts. Mantener en sintonía con src/routes/exchange.routes.ts.
 */

const fetched = "2026-11-26T17:57:15.613Z";

const quoteArsUsd = {
  from_currency: "ARS",
  from_amount: "145500",
  to_currency: "USD",
  to_amount: "100",
  rate: "0.0006872852",
  mid_to_amount: "101.75",
  spread: "0.0172",
  type: "BUY",
  rate_type: "oficial",
  rate_source: "dolarapi.com",
  rate_fetched_at: fetched,
  rates_used: [{ pair: "USD/ARS", buy: "1405", sell: "1455", mid: "1430" }],
  stale: false,
};

const quoteArsBtc = {
  from_currency: "ARS",
  from_amount: "500000",
  to_currency: "BTC",
  to_amount: "0.00379396",
  rate: "0.0000000076",
  mid_to_amount: "0.0038796",
  spread: "0.0221",
  type: "BUY",
  rate_type: "spot",
  rate_source: "coingecko.com + dolarapi.com",
  rate_fetched_at: fetched,
  rates_used: [
    { pair: "USD/ARS", buy: "1405", sell: "1455", mid: "1430" },
    { pair: "BTC/USD", buy: "89674.7929", sell: "90576.0471", mid: "90125.42" },
  ],
  stale: false,
};

const exchangeArsUsd = {
  id: "41b79e4c-bc31-4dbf-9dfe-521bb4ed1b2c",
  type: "BUY",
  from_currency: "ARS",
  from_amount: "145500",
  from_balance_after: "854500",
  to_currency: "USD",
  to_amount: "100",
  to_balance_after: "100",
  rate: "0.0006872852",
  rate_type: "oficial",
  rate_side: "buy",
  spread: "0.0172",
  rate_source: "dolarapi.com",
  rate_fetched_at: fetched,
  idempotency_key: "conv-7f3a9c21-0001",
  created_at: "2026-11-26T17:57:29.522Z",
};

const currencyEnum = { type: "string", enum: ["ARS", "USD", "USDT", "BTC"] };

const exchangeFields = {
  from: { ...currencyEnum, description: "Moneda que entregás (no distingue mayúsculas)" },
  to: { ...currencyEnum, description: "Moneda que recibís. Debe ser distinta de `from`" },
  amount: {
    type: "string",
    description: "Monto a entregar en `from`. Decimales máximos: ARS y USD 2, USDT 6, BTC 8. También acepta número",
    example: "145500",
  },
};

const validationExamples = {
  mismaMoneda: {
    summary: "Misma moneda",
    value: { error: "Datos inválidos", details: [{ field: "to", message: "La moneda de destino debe ser distinta a la de origen" }] },
  },
  decimales: {
    summary: "Demasiados decimales",
    value: { error: "Datos inválidos", details: [{ field: "amount", message: "USD admite hasta 2 decimales" }] },
  },
  monedaInvalida: {
    summary: "Moneda no soportada",
    value: { error: "Datos inválidos", details: [{ field: "from", message: "from debe ser ARS, USD, USDT o BTC" }] },
  },
};

const unavailable = {
  description: "No hay cotización vigente para operar (fuente externa caída). Nunca se opera con precios desactualizados",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
      example: { error: "Las cotizaciones están desactualizadas, intentá de nuevo en unos minutos" },
    },
  },
};

export const exchangeTag = {
  name: "Conversiones",
  description: "Conversión entre ARS, USD, USDT y BTC con cotización y spread transparentes",
};

export const exchangeSchemas = {
  ExchangeQuote: {
    type: "object",
    required: [
      "from_currency", "from_amount", "to_currency", "to_amount", "rate", "mid_to_amount",
      "spread", "type", "rate_type", "rate_source", "rate_fetched_at", "rates_used", "stale",
    ],
    properties: {
      from_currency: currencyEnum,
      from_amount: { type: "string", description: "Monto que entregás" },
      to_currency: currencyEnum,
      to_amount: { type: "string", description: "Monto que recibís (redondeado hacia abajo a los decimales de la moneda)" },
      rate: { type: "string", description: "Unidades de `to_currency` por cada unidad de `from_currency`" },
      mid_to_amount: { type: "string", description: "Lo que recibirías al precio de mercado, sin spread" },
      spread: { type: "string", description: "Costo total de la operación respecto del precio de mercado (0.0172 = 1,72%)" },
      type: { type: "string", enum: ["BUY", "SELL", "EXCHANGE"], description: "`BUY`: pesos → dólar o fiat → cripto. `SELL`: al revés. `EXCHANGE`: cripto ↔ cripto" },
      rate_type: { type: "string", enum: ["oficial", "spot"] },
      rate_source: { type: "string", example: "dolarapi.com" },
      rate_fetched_at: { type: "string", format: "date-time", description: "Hora de la cotización más antigua usada" },
      rates_used: {
        type: "array",
        description: "Cotizaciones usadas en el cálculo",
        items: {
          type: "object",
          properties: { pair: { type: "string" }, buy: { type: "string" }, sell: { type: "string" }, mid: { type: "string" } },
        },
      },
      stale: { type: "boolean", description: "`true` si alguna cotización está desactualizada: en ese caso la conversión real va a ser rechazada" },
    },
  },
  Exchange: {
    type: "object",
    description: "Conversión registrada en `transactions`",
    properties: {
      id: { type: "string", format: "uuid" },
      type: { type: "string", enum: ["BUY", "SELL", "EXCHANGE"] },
      from_currency: currencyEnum,
      from_amount: { type: "string" },
      from_balance_after: { type: "string", description: "Saldo de `from_currency` después de la operación" },
      to_currency: currencyEnum,
      to_amount: { type: "string" },
      to_balance_after: { type: "string", description: "Saldo de `to_currency` después de la operación" },
      rate: { type: "string" },
      rate_type: { type: "string", enum: ["oficial", "spot"] },
      rate_side: { type: "string", enum: ["buy", "sell"], nullable: true, description: "`buy` si compraste, `sell` si vendiste, `null` en cripto ↔ cripto" },
      spread: { type: "string", description: "Costo exacto cobrado respecto del precio de mercado" },
      rate_source: { type: "string" },
      rate_fetched_at: { type: "string", format: "date-time" },
      idempotency_key: { type: "string" },
      created_at: { type: "string", format: "date-time" },
    },
  },
};

export const exchangePaths = {
  "/exchange/quote": {
    post: {
      tags: ["Conversiones"],
      operationId: "quoteExchange",
      summary: "Cotizar una conversión (no mueve dinero)",
      description: [
        "Calcula cuánto recibirías, con la cotización y el spread exactos. **No modifica saldos.**",
        "",
        "El front la usa para mostrar \"Vas a recibir X\" antes de que el usuario confirme.",
        "",
        "**Cómo se calcula:** todas las conversiones pasan por el dólar como moneda puente.",
        "Lo que entregás se valúa al precio de compra de Refugio (`buy`) y lo que recibís se cobra al precio de venta (`sell`).",
      ].join("\n"),
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", required: ["from", "to", "amount"], additionalProperties: false, properties: exchangeFields },
            examples: {
              pesosADolares: { summary: "Pesos → dólares", value: { from: "ARS", to: "USD", amount: "145500" } },
              pesosABitcoin: { summary: "Pesos → Bitcoin", value: { from: "ARS", to: "BTC", amount: "500000" } },
              dolaresAUsdt: { summary: "Dólares → USDT", value: { from: "USD", to: "USDT", amount: "100" } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Cotización calculada",
          content: {
            "application/json": {
              schema: { type: "object", required: ["quote"], properties: { quote: { $ref: "#/components/schemas/ExchangeQuote" } } },
              examples: {
                pesosADolares: { summary: "Pesos → dólares (spread de los bancos)", value: { quote: quoteArsUsd } },
                pesosABitcoin: { summary: "Pesos → Bitcoin (dos tramos)", value: { quote: quoteArsBtc } },
              },
            },
          },
        },
        "400": {
          description: "Datos inválidos",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationError" }, examples: validationExamples } },
        },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "422": {
          description: "El monto es demasiado chico para la moneda de destino",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: { error: "El monto es demasiado chico: recibirías 0 BTC" },
            },
          },
        },
        "503": unavailable,
        "500": { $ref: "#/components/responses/InternalError" },
      },
    },
  },
  "/exchange": {
    post: {
      tags: ["Conversiones"],
      operationId: "createExchange",
      summary: "Convertir saldo entre monedas",
      description: [
        "Convierte saldo del usuario entre **ARS, USD, USDT y BTC** en una única transacción de base de datos:",
        "",
        "1. Bloquea los dos saldos (evita gastar dos veces el mismo dinero con pedidos simultáneos).",
        "2. Verifica que haya saldo suficiente.",
        "3. Debita `from`, acredita `to` y registra la operación en `transactions` con la cotización, el spread y la fuente usados.",
        "",
        "**Protecciones:**",
        "- `idempotency_key`: si se repite el pedido (por ejemplo, doble clic), devuelve la operación original con `replayed: true` y no vuelve a mover dinero. Usá un valor nuevo (por ejemplo un UUID) para cada conversión.",
        "- Nunca se opera con cotizaciones desactualizadas: si la fuente externa está caída, responde 503.",
      ].join("\n"),
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["from", "to", "amount", "idempotency_key"],
              additionalProperties: false,
              properties: {
                ...exchangeFields,
                idempotency_key: { type: "string", minLength: 8, maxLength: 64, description: "Identificador único de esta operación" },
              },
            },
            examples: {
              pesosADolares: {
                summary: "Comprar USD 100 con pesos",
                value: { from: "ARS", to: "USD", amount: "145500", idempotency_key: "conv-7f3a9c21-0001" },
              },
              dolaresABitcoin: {
                summary: "Comprar Bitcoin con USD 50",
                value: { from: "USD", to: "BTC", amount: "50", idempotency_key: "conv-7f3a9c21-0002" },
              },
              saldoInsuficiente: {
                summary: "Saldo insuficiente (devuelve 422)",
                value: { from: "USD", to: "ARS", amount: "999999", idempotency_key: "conv-7f3a9c21-0003" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Conversión realizada",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["exchange", "replayed"],
                properties: { exchange: { $ref: "#/components/schemas/Exchange" }, replayed: { type: "boolean", example: false } },
              },
              example: { exchange: exchangeArsUsd, replayed: false },
            },
          },
        },
        "200": {
          description: "La `idempotency_key` ya se había usado: se devuelve la operación original sin mover dinero",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { exchange: { $ref: "#/components/schemas/Exchange" }, replayed: { type: "boolean", example: true } },
              },
              example: { exchange: exchangeArsUsd, replayed: true },
            },
          },
        },
        "400": {
          description: "Datos inválidos",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationError" }, examples: validationExamples } },
        },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "404": { $ref: "#/components/responses/NotSynced" },
        "409": {
          description: "La `idempotency_key` ya se usó en otra operación",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: { error: "La idempotency_key ya fue usada en otra operación" },
            },
          },
        },
        "422": {
          description: "Saldo insuficiente o monto demasiado chico",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              examples: {
                saldo: { summary: "Saldo insuficiente", value: { error: "Saldo insuficiente: tenés 50 USD" } },
                chico: { summary: "Monto demasiado chico", value: { error: "El monto es demasiado chico: recibirías 0 BTC" } },
              },
            },
          },
        },
        "503": unavailable,
        "500": { $ref: "#/components/responses/InternalError" },
      },
    },
  },
};
