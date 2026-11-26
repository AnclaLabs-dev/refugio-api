/**
 * Documentación OpenAPI del resumen de billetera (/wallet/summary).
 * Se integra en openapi.ts. Mantener en sintonía con src/services/summary.service.ts.
 */

const exampleSummary = {
  total_usd: "693.99",
  total_ars: "992409.26",
  valued_at: "2026-11-26T18:59:43.606Z",
  stale: false,
  composition: [
    { currency: "ARS", name: "Peso argentino", type: "fiat", amount: "600000", value_usd: "419.58", value_ars: "600000.00", percent: "60.46" },
    { currency: "USD", name: "Dólar estadounidense", type: "fiat", amount: "174.91", value_usd: "174.91", value_ars: "250121.30", percent: "25.20" },
    { currency: "BTC", name: "Bitcoin", type: "crypto", amount: "0.00110404", value_usd: "99.50", value_ars: "142287.96", percent: "14.34" },
    { currency: "USDT", name: "Tether", type: "crypto", amount: "0", value_usd: "0.00", value_ars: "0.00", percent: "0.00" },
  ],
  days: 7,
  variation: {
    from_date: "2026-11-20",
    to_date: "2026-11-26",
    start_usd: "729.93",
    end_usd: "693.99",
    change_usd: "-35.94",
    change_percent_usd: "-4.92",
    start_ars: "1000000.00",
    end_ars: "992409.26",
    change_ars: "-7590.74",
    change_percent_ars: "-0.76",
  },
  history: [
    { date: "2026-11-20", total_usd: "729.93", total_ars: "1000000.00" },
    { date: "2026-11-21", total_usd: "709.69", total_ars: "979375.80" },
    { date: "2026-11-22", total_usd: "706.56", total_ars: "982124.90" },
    { date: "2026-11-23", total_usd: "703.48", total_ars: "984874.00" },
    { date: "2026-11-24", total_usd: "700.44", total_ars: "987623.10" },
    { date: "2026-11-25", total_usd: "697.45", total_ars: "990372.20" },
    { date: "2026-11-26", total_usd: "693.99", total_ars: "992409.26" },
  ],
};

const newUserSummary = {
  ...exampleSummary,
  total_usd: "0.00",
  total_ars: "0.00",
  composition: exampleSummary.composition.map((c) => ({ ...c, amount: "0", value_usd: "0.00", value_ars: "0.00", percent: "0.00" })),
  variation: null,
  history: exampleSummary.history.map((h, i) => ({ ...h, total_usd: i < 2 ? null : "0.00", total_ars: i < 2 ? null : "0.00" })),
};

export const summarySchemas = {
  WalletSummary: {
    type: "object",
    required: ["total_usd", "total_ars", "valued_at", "stale", "composition", "days", "variation", "history"],
    properties: {
      total_usd: { type: "string", description: "Patrimonio total en dólares, a precio de mercado", example: "693.99" },
      total_ars: { type: "string", description: "Patrimonio total en pesos, a dólar oficial de mercado", example: "992409.26" },
      valued_at: { type: "string", format: "date-time", description: "Hora de la cotización más antigua usada" },
      stale: { type: "boolean", description: "`true` si alguna cotización está desactualizada" },
      composition: {
        type: "array",
        description: "Saldo y valor de cada moneda, de mayor a menor valor (para el gráfico de dona)",
        items: {
          type: "object",
          required: ["currency", "name", "type", "amount", "value_usd", "value_ars", "percent"],
          properties: {
            currency: { type: "string", enum: ["ARS", "USD", "USDT", "BTC"] },
            name: { type: "string" },
            type: { type: "string", enum: ["fiat", "crypto"] },
            amount: { type: "string", description: "Saldo en la propia moneda" },
            value_usd: { type: "string" },
            value_ars: { type: "string" },
            percent: { type: "string", description: "Porcentaje del patrimonio total (0 a 100)", example: "60.46" },
          },
        },
      },
      days: { type: "integer", description: "Cantidad de días del período consultado", example: 30 },
      variation: {
        type: "object",
        nullable: true,
        description:
          "Cambio del patrimonio desde el primer día del período con saldo mayor a 0 hasta hoy. **Incluye cargas y conversiones**: no es un rendimiento puro. `null` si no hay al menos dos días con datos",
        properties: {
          from_date: { type: "string", format: "date" },
          to_date: { type: "string", format: "date" },
          start_usd: { type: "string" },
          end_usd: { type: "string" },
          change_usd: { type: "string", example: "-35.94" },
          change_percent_usd: { type: "string", nullable: true, example: "-4.92" },
          start_ars: { type: "string" },
          end_ars: { type: "string" },
          change_ars: { type: "string" },
          change_percent_ars: { type: "string", nullable: true },
        },
      },
      history: {
        type: "array",
        description: "Un punto por día del período (para el gráfico de línea). `null` en los días sin cotizaciones registradas",
        items: {
          type: "object",
          required: ["date", "total_usd", "total_ars"],
          properties: {
            date: { type: "string", format: "date" },
            total_usd: { type: "string", nullable: true },
            total_ars: { type: "string", nullable: true },
          },
        },
      },
    },
  },
};

export const summaryPaths = {
  "/wallet/summary": {
    get: {
      tags: ["Billetera"],
      operationId: "getWalletSummary",
      summary: "Resumen del patrimonio: total, composición y evolución",
      description: [
        "Datos listos para el dashboard y los gráficos:",
        "",
        "- **Total** en USD y en ARS.",
        "- **Composición** por moneda con su porcentaje (gráfico de dona).",
        "- **Evolución diaria** de los últimos `days` días y su **variación** (gráfico de línea).",
        "",
        "**Cómo se valúa:** a precio de mercado (punto medio entre compra y venta, sin spread).",
        "La evolución combina el saldo de cada día (según los movimientos registrados) con la cotización de cierre de ese día.",
      ].join("\n"),
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "days",
          in: "query",
          required: false,
          description: "Cantidad de días de la evolución (entre 7 y 365)",
          schema: { type: "integer", minimum: 7, maximum: 365, default: 30 },
          example: 30,
        },
      ],
      responses: {
        "200": {
          description: "Resumen del patrimonio",
          content: {
            "application/json": {
              schema: { type: "object", required: ["summary"], properties: { summary: { $ref: "#/components/schemas/WalletSummary" } } },
              examples: {
                conSaldo: { summary: "Usuario con pesos, dólares y Bitcoin", value: { summary: exampleSummary } },
                nuevo: { summary: "Usuario recién registrado", value: { summary: newUserSummary } },
              },
            },
          },
        },
        "400": {
          description: "Parámetro inválido",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationError" },
              example: { error: "Datos inválidos", details: [{ field: "days", message: "days debe ser al menos 7" }] },
            },
          },
        },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "404": { $ref: "#/components/responses/NotSynced" },
        "503": {
          description: "No hay cotizaciones disponibles para valuar",
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
};
