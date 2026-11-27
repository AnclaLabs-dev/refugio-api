const exampleTransfer = {
  id: "f561a9a8-0d7b-4e63-95be-fa886664edde",
  direction: "sent",
  currency: "USD",
  amount: "50.00",
  balance_after: "150.00",
  counterparty: { name: "Dante Cáceres", alias: "dante.caceres.refugio" },
  idempotency_key: "7cba13cc-c1c5-4aa8-b5c6-000e69caaf88",
  created_at: "2026-11-27T04:59:16.285Z",
};

const errorExample = (summary: string, error: string) => ({ summary, value: { error } });

export const transferTag = { name: "Transferencias", description: "Envío de dinero entre usuarios de Refugio por alias" };

export const transferSchemas = {
  TransferRequest: {
    type: "object",
    required: ["to_alias", "currency", "amount", "idempotency_key"],
    additionalProperties: false,
    properties: {
      to_alias: { type: "string", description: "Alias del destinatario. No distingue mayúsculas.", example: "dante.caceres.refugio" },
      currency: { type: "string", enum: ["ARS", "USD"] },
      amount: {
        oneOf: [{ type: "string" }, { type: "number" }],
        description: "Mayor a 0, hasta 2 decimales y como máximo el tope diario de la moneda",
        example: "50",
      },
      idempotency_key: {
        type: "string",
        minLength: 8,
        maxLength: 64,
        description: "Generada por el front (crypto.randomUUID()) una vez por transferencia y reenviada igual en cada reintento",
      },
    },
  },
  Transfer: {
    type: "object",
    required: ["id", "direction", "currency", "amount", "balance_after", "counterparty", "idempotency_key", "created_at"],
    properties: {
      id: { type: "string", format: "uuid" },
      direction: { type: "string", enum: ["sent"] },
      currency: { type: "string", enum: ["ARS", "USD"] },
      amount: { type: "string", example: "50.00" },
      balance_after: { type: "string", description: "Saldo del que envía después de la transferencia", example: "150.00" },
      counterparty: { $ref: "#/components/schemas/PublicProfile" },
      idempotency_key: { type: "string" },
      created_at: { type: "string", format: "date-time" },
    },
    example: exampleTransfer,
  },
};

export const transferPaths = {
  "/transfers": {
    post: {
      tags: ["Transferencias"],
      operationId: "createTransfer",
      summary: "Transferir dinero a otro usuario por alias",
      description: [
        "Envía ARS o USD a otro usuario de Refugio. Todo ocurre en una sola operación: si algo falla, no se mueve dinero.",
        "",
        "- Se transfiere en la **misma moneda** (USD a USD, ARS a ARS).",
        "- **Tope diario** de lo enviado: **100.000.000 ARS** y **100.000 USD** (lo recibido no cuenta).",
        "- El destinatario ve el movimiento como **recibido** en su historial.",
        "",
        "**Idempotencia:** si se reenvía la misma `idempotency_key` con los mismos datos, devuelve la transferencia original con `replayed: true` (200) sin mover dinero. Si se reenvía con otros datos, devuelve 422.",
        "",
        "Antes de transferir, el front puede confirmar el destinatario con `GET /aliases/{alias}`.",
      ].join("\n"),
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/TransferRequest" },
            examples: {
              usd: {
                summary: "Enviar USD 50",
                value: { to_alias: "dante.caceres.refugio", currency: "USD", amount: "50", idempotency_key: "7cba13cc-c1c5-4aa8-b5c6-000e69caaf88" },
              },
              ars: {
                summary: "Enviar ARS 1.000",
                value: { to_alias: "dante.caceres.refugio", currency: "ARS", amount: "1000", idempotency_key: "0b6d1c2e-9f4a-4e1b-8c3d-2a5f7e9b1d40" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Transferencia realizada",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["transfer", "replayed"],
                properties: { transfer: { $ref: "#/components/schemas/Transfer" }, replayed: { type: "boolean", example: false } },
              },
              example: { transfer: exampleTransfer, replayed: false },
            },
          },
        },
        "200": {
          description: "Reintento con la misma idempotency_key: se devuelve la transferencia original sin mover dinero",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["transfer", "replayed"],
                properties: { transfer: { $ref: "#/components/schemas/Transfer" }, replayed: { type: "boolean", example: true } },
              },
              example: { transfer: exampleTransfer, replayed: true },
            },
          },
        },
        "400": {
          description: "Datos inválidos",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationError" },
              examples: {
                montoCero: {
                  summary: "Monto 0",
                  value: { error: "Datos inválidos", details: [{ field: "amount", message: "El monto debe ser mayor a 0" }] },
                },
                moneda: {
                  summary: "Moneda no permitida",
                  value: { error: "Datos inválidos", details: [{ field: "currency", message: "La moneda debe ser ARS o USD" }] },
                },
              },
            },
          },
        },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "404": {
          description: "Usuario no sincronizado o alias inexistente",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              examples: {
                alias: errorExample("Alias inexistente", "No existe ningún usuario con ese alias"),
                noSincronizado: errorExample("Usuario no sincronizado", "Usuario no sincronizado, llama primero a POST /auth/sync"),
              },
            },
          },
        },
        "409": {
          description: "La idempotency_key ya se usó en otra operación",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: { error: "La idempotency_key ya fue usada en otra operación" },
            },
          },
        },
        "422": {
          description: "La transferencia no cumple una regla de negocio",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              examples: {
                saldo: errorExample("Saldo insuficiente", "Saldo insuficiente: tenés 30.00 USD"),
                propia: errorExample("A la propia cuenta", "No se puede transferir a la propia cuenta"),
                tope: errorExample("Tope diario", "Superaste el tope diario de transferencias de 100.000 USD"),
                keyDistinta: errorExample("Key reusada con otros datos", "La idempotency_key ya se usó en una transferencia con otros datos"),
              },
            },
          },
        },
        "500": { $ref: "#/components/responses/InternalError" },
      },
    },
  },
};
