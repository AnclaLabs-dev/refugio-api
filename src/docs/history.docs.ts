const exampleSent = {
  id: "27c26991-6dde-4f1f-9375-8577ca869d6b",
  type: "TRANSFER",
  direction: "sent",
  from: { currency: "USD", amount: "1000.00", balance_after: "500.00" },
  to: null,
  rate: null,
  counterparty: { name: "Gabriel Rey", alias: "gabrielrey9695.517e13" },
  created_at: "2026-11-27T16:20:35.948Z",
};

const exampleBuy = {
  id: "9b1f0c4e-2d3a-4f5b-8c6d-7e8f9a0b1c2d",
  type: "BUY",
  direction: null,
  from: { currency: "USD", amount: "100.00", balance_after: "400.00" },
  to: { currency: "BTC", amount: "0.00110404", balance_after: "0.00110404" },
  rate: "0.0000110404",
  counterparty: null,
  created_at: "2026-11-26T18:59:43.606Z",
};

const exampleDeposit = {
  id: "4c5d6e7f-8091-4a2b-9c3d-4e5f60718293",
  type: "DEPOSIT",
  direction: null,
  from: null,
  to: { currency: "ARS", amount: "15000.50", balance_after: "15000.50" },
  rate: null,
  counterparty: null,
  created_at: "2026-11-25T12:00:00.000Z",
};

const query = (name: string, description: string, schema: object, example?: string) => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
  ...(example ? { example } : {}),
});

export const historySchemas = {
  MovementSide: {
    type: "object",
    required: ["currency", "amount", "balance_after"],
    properties: {
      currency: { type: "string", enum: ["ARS", "USD", "USDT", "BTC"] },
      amount: { type: "string", description: "Truncado a los decimales de la moneda", example: "50.00" },
      balance_after: { type: "string", description: "Saldo de esa moneda después del movimiento", example: "450.00" },
    },
  },
  HistoryItem: {
    type: "object",
    required: ["id", "type", "direction", "from", "to", "rate", "counterparty", "created_at"],
    properties: {
      id: { type: "string", format: "uuid" },
      type: { type: "string", enum: ["DEPOSIT", "BUY", "SELL", "EXCHANGE", "TRANSFER"] },
      direction: { type: "string", enum: ["sent", "received"], nullable: true, description: "Solo en transferencias" },
      from: {
        allOf: [{ $ref: "#/components/schemas/MovementSide" }],
        nullable: true,
        description: "Lo que salió. null en depósitos y transferencias recibidas",
      },
      to: {
        allOf: [{ $ref: "#/components/schemas/MovementSide" }],
        nullable: true,
        description: "Lo que entró. null en transferencias enviadas",
      },
      rate: { type: "string", nullable: true, description: "Solo en conversiones" },
      counterparty: {
        allOf: [{ $ref: "#/components/schemas/PublicProfile" }],
        nullable: true,
        description: "La otra persona, solo en transferencias",
      },
      created_at: { type: "string", format: "date-time" },
    },
  },
};

export const historyPaths = {
  "/wallet/transactions": {
    get: {
      tags: ["Billetera"],
      operationId: "listTransactions",
      summary: "Historial de transacciones con filtros",
      description: [
        "Devuelve los movimientos del usuario autenticado, del más nuevo al más viejo: recargas, conversiones y transferencias.",
        "",
        "**Cómo leer cada movimiento:**",
        "- `DEPOSIT`: solo `to` (lo que se cargó).",
        "- `TRANSFER` enviada (`direction: sent`): solo `from`. Recibida (`direction: received`): solo `to`. `counterparty` es la otra persona.",
        "- `BUY` / `SELL` / `EXCHANGE`: `from` (lo que se entregó), `to` (lo que se recibió) y `rate`.",
        "",
        "**Pestañas típicas:** Todos (sin filtros), Ingresos (`flow=in`), Egresos (`flow=out`), Conversiones (`type=BUY,SELL,EXCHANGE`).",
        "",
        "**Paginación:** si hay más resultados, la respuesta trae `next_cursor`. Para la página siguiente, se repite la misma consulta agregando `cursor=<next_cursor>`. Cuando es `null`, no hay más.",
        "",
        "**Rango de montos:** requiere `currency` y compara el monto de esa moneda. Topes: ARS 100.000.000, USD 100.000, USDT 100.000, BTC 10.",
      ].join("\n"),
      security: [{ bearerAuth: [] }],
      parameters: [
        query("type", "Uno o varios tipos separados por coma", { type: "string" }, "TRANSFER"),
        query("currency", "Movimientos donde entra o sale esta moneda", { type: "string", enum: ["ARS", "USD", "USDT", "BTC"] }),
        query("direction", "Solo transferencias enviadas o recibidas", { type: "string", enum: ["sent", "received"] }),
        query(
          "flow",
          "in: dinero que entra (recargas y transferencias recibidas). out: dinero que sale (transferencias enviadas). Las conversiones no entran en ninguno. No se combina con direction",
          { type: "string", enum: ["in", "out"] }
        ),
        query("from", "Desde esta fecha (hora argentina), inclusive", { type: "string", format: "date" }, "2026-11-01"),
        query("to", "Hasta esta fecha (hora argentina), inclusive", { type: "string", format: "date" }, "2026-11-30"),
        query("min_amount", "Monto mínimo (requiere currency)", { type: "string" }, "0"),
        query("max_amount", "Monto máximo (requiere currency)", { type: "string" }, "5000"),
        query("limit", "Cantidad por página (1 a 100)", { type: "integer", minimum: 1, maximum: 100, default: 20 }),
        query("cursor", "El next_cursor de la respuesta anterior", { type: "string" }),
      ],
      responses: {
        "200": {
          description: "Página del historial",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["transactions", "next_cursor"],
                properties: {
                  transactions: { type: "array", items: { $ref: "#/components/schemas/HistoryItem" } },
                  next_cursor: { type: "string", nullable: true },
                },
              },
              example: {
                transactions: [exampleSent, exampleBuy, exampleDeposit],
                next_cursor: "MjAyNi0xMS0yNVQxMjowMDowMC4wMDAwMDBafDRjNWQ2ZTdm",
              },
            },
          },
        },
        "400": {
          description: "Filtros inválidos",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationError" },
              examples: {
                montoSinMoneda: {
                  summary: "Rango de montos sin currency",
                  value: { error: "Datos inválidos", details: [{ field: "currency", message: "Para filtrar por monto indicá la moneda (currency)" }] },
                },
                tope: {
                  summary: "Monto mayor al tope",
                  value: { error: "Datos inválidos", details: [{ field: "max_amount", message: "max_amount no puede superar 100.000 USD" }] },
                },
                fechas: {
                  summary: "from posterior a to",
                  value: { error: "Datos inválidos", details: [{ field: "from", message: "from no puede ser posterior a to" }] },
                },
              },
            },
          },
        },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "404": { $ref: "#/components/responses/NotSynced" },
        "500": { $ref: "#/components/responses/InternalError" },
      },
    },
  },
};
