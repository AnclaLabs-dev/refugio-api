/**
 * Especificación OpenAPI 3.0 de la API de Refugio.
 * Se sirve en /api-docs (Swagger UI) y en /api-docs.json (JSON crudo).
 *
 * Al agregar o modificar un endpoint, actualizar también este archivo.
 */

import { ratesPaths, ratesSchemas, ratesTag } from "./rates.docs";
import { exchangePaths, exchangeSchemas, exchangeTag } from "./exchange.docs";
import { summaryPaths, summarySchemas } from "./summary.docs";
import { aliasPaths, aliasRules, aliasSchemas, aliasTag } from "./alias.docs";
import { transferPaths, transferSchemas, transferTag } from "./transfer.docs";

const PROD_URL = "https://refugio-api-production-1c49e3aa.up.railway.app";

// ---------- Ejemplos reutilizables ----------

const exampleUser = {
  id: "3f8b2c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c",
  firebase_uid: "Xk9pL2mN4qR7sT1uV3wY5zA8bC0d",
  email: "dante@anclalabs.dev",
  name: "Dante Cáceres",
  alias: "dante.caceres.refugio",
  alias_updated_at: null,
  created_at: "2026-11-20T14:32:10.000Z",
};

const exampleBalances = [
  { currency_code: "ARS", name: "Peso argentino", type: "fiat", decimals: 2, amount: "150000.00", updated_at: "2026-11-24T12:00:00.000Z" },
  { currency_code: "USD", name: "Dólar estadounidense", type: "fiat", decimals: 2, amount: "320.50", updated_at: "2026-11-24T12:00:00.000Z" },
  { currency_code: "USDT", name: "Tether", type: "crypto", decimals: 6, amount: "100.000000", updated_at: "2026-11-24T12:00:00.000Z" },
  { currency_code: "BTC", name: "Bitcoin", type: "crypto", decimals: 8, amount: "0.00125000", updated_at: "2026-11-24T12:00:00.000Z" },
];

const notSyncedExample = {
  summary: "Usuario no sincronizado",
  value: { error: "Usuario no sincronizado, llama primero a POST /auth/sync" },
};

// ---------- Especificación ----------

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Refugio API",
    version: "1.0.0",
    description: [
      "API REST de **Refugio**, la billetera virtual anti-inflación de **Ancla Labs** (Proyecto Final Full Stack · SoyHenry).",
      "",
      "Con esta documentación se puede probar todo el backend **sin usar el frontend**.",
      "",
      "## Cómo probar los endpoints protegidos",
      "1. **Obtener un ID token de Firebase.** Tiene que ser de un usuario registrado en el proyecto de Firebase de Refugio.",
      "   - Desde el repo: `npm run token -- <email> <password>` (ver README).",
      "   - O desde la app web ya logueada: DevTools → Application → IndexedDB → `firebaseLocalStorageDb` → `stsTokenManager.accessToken`.",
      "2. Hacer clic en **Authorize** 🔒 (arriba a la derecha), pegar el token **sin** la palabra `Bearer` y confirmar.",
      "3. Ejecutar primero **`POST /auth/sync`**. Ese endpoint crea el usuario en PostgreSQL junto con su billetera y sus saldos en 0.",
      "4. Ya se pueden usar `/me`, `/wallet` y `/users`.",
      "",
      "> El token de Firebase vence a la hora. Si aparece `401 Token inválido o expirado`, hay que generar uno nuevo.",
      "",
      "## Formato de errores",
      "Todos los errores devuelven JSON con la propiedad `error`. Los errores de validación (400) agregan `details` con el campo y el motivo.",
    ].join("\n"),
    contact: { name: "Ancla Labs", url: "https://github.com/AnclaLabs-dev" },
  },
  servers: [
    { url: "/", description: "Servidor actual (desde donde abriste esta documentación)" },
    { url: PROD_URL, description: "Producción (Railway)" },
    { url: "http://localhost:3000", description: "Desarrollo local" },
  ],
  tags: [
    { name: "Health", description: "Estado del servicio" },
    { name: "Auth", description: "Sincronización del usuario de Firebase con la base de datos" },
    { name: "Perfil", description: "Datos del usuario autenticado" },
    { name: "Usuarios", description: "Listado de usuarios registrados" },
    { name: "Billetera", description: "Billetera multimoneda y saldos del usuario autenticado" },
    ratesTag,
    exchangeTag,
    aliasTag,
    transferTag,
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT (Firebase ID token)",
        description: "ID token emitido por Firebase Authentication. Pegar solo el token, sin el prefijo `Bearer`.",
      },
    },
    schemas: {
      ...ratesSchemas,
      ...exchangeSchemas,
      ...summarySchemas,
      ...aliasSchemas,
      ...transferSchemas,
      User: {
        type: "object",
        description: "Usuario completo (solo se devuelve al propio usuario)",
        required: ["id", "firebase_uid", "email", "name", "alias", "alias_updated_at", "created_at"],
        properties: {
          id: { type: "string", format: "uuid", description: "ID interno en PostgreSQL" },
          firebase_uid: { type: "string", description: "UID del usuario en Firebase Authentication" },
          email: { type: "string", format: "email" },
          name: { type: "string", nullable: true, maxLength: 100 },
          alias: {
            type: "string",
            minLength: 3,
            maxLength: 30,
            description: "Alias único para recibir transferencias. Se genera al registrarse y se puede cambiar con PATCH /me",
          },
          alias_updated_at: {
            type: "string",
            format: "date-time",
            nullable: true,
            description: "Última vez que el usuario modificó su alias. Es null si nunca lo modificó (el alias automático no cuenta)",
          },
          created_at: { type: "string", format: "date-time" },
        },
        example: exampleUser,
      },
      UserSummary: {
        type: "object",
        description: "Datos públicos de un usuario (no incluye el UID de Firebase)",
        required: ["id", "email", "name", "created_at"],
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          name: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Pagination: {
        type: "object",
        required: ["page", "limit", "total", "totalPages"],
        properties: {
          page: { type: "integer", example: 1 },
          limit: { type: "integer", example: 10 },
          total: { type: "integer", description: "Cantidad total de usuarios que cumplen el filtro", example: 23 },
          totalPages: { type: "integer", example: 3 },
        },
      },
      CurrencyCode: {
        type: "string",
        enum: ["ARS", "USD", "USDT", "BTC"],
        description: "Código de moneda soportada",
      },
      Balance: {
        type: "object",
        required: ["currency_code", "name", "type", "decimals", "amount", "updated_at"],
        properties: {
          currency_code: { $ref: "#/components/schemas/CurrencyCode" },
          name: { type: "string", example: "Dólar estadounidense" },
          type: { type: "string", enum: ["fiat", "crypto"] },
          decimals: { type: "integer", description: "Decimales con los que se expresa la moneda", example: 2 },
          amount: {
            type: "string",
            description: "Saldo como texto decimal (evita la pérdida de precisión de los números en JavaScript)",
            example: "320.50",
          },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      Wallet: {
        type: "object",
        required: ["id", "balances"],
        properties: {
          id: { type: "string", format: "uuid" },
          balances: { type: "array", items: { $ref: "#/components/schemas/Balance" } },
        },
      },
      DepositRequest: {
        type: "object",
        required: ["currency", "amount", "idempotency_key"],
        properties: {
          currency: { type: "string", enum: ["ARS", "USD"] },
          amount: {
            type: "string",
            description: "Monto a cargar con hasta 2 decimales. Mínimo 1; máximo 1.000.000 ARS o 1.000 USD por carga",
            example: "15000.50",
          },
          idempotency_key: {
            type: "string",
            minLength: 8,
            maxLength: 64,
            description: "Clave única por intento de carga (se recomienda un UUID). Si se repite, no se vuelve a cargar",
            example: "3f6c1b9e-2d4a-4c8b-9e7f-1a2b3c4d5e6f",
          },
        },
      },
      Deposit: {
        type: "object",
        required: ["id", "type", "currency", "amount", "balance_after", "idempotency_key", "email_status", "created_at"],
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["DEPOSIT"] },
          currency: { type: "string", enum: ["ARS", "USD"] },
          amount: { type: "string", example: "15000.50" },
          balance_after: { type: "string", description: "Saldo de la moneda después de la carga", example: "15000.50" },
          idempotency_key: { type: "string" },
          email_status: { type: "string", enum: ["PENDING", "SENT", "FAILED"] },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string", description: "Mensaje legible del error" } },
      },
      ValidationError: {
        type: "object",
        required: ["error", "details"],
        properties: {
          error: { type: "string", example: "Datos inválidos" },
          details: {
            type: "array",
            items: {
              type: "object",
              required: ["field", "message"],
              properties: {
                field: { type: "string", example: "name" },
                message: { type: "string", example: "El nombre no puede estar vacío" },
              },
            },
          },
        },
      },
    },
    parameters: {
      CurrencyParam: {
        name: "currency",
        in: "path",
        required: true,
        description: "Código de moneda: `ARS`, `USD`, `USDT` o `BTC`. No distingue mayúsculas de minúsculas.",
        schema: { type: "string" },
        examples: {
          USD: { value: "USD", summary: "Dólar" },
          BTC: { value: "BTC", summary: "Bitcoin" },
          minusculas: { value: "ars", summary: "En minúsculas (también funciona)" },
          noSoportada: { value: "EUR", summary: "Moneda no soportada (devuelve 404)" },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "Falta el token, o es inválido o expiró",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            examples: {
              sinToken: { summary: "Sin header Authorization", value: { error: "Falta el token de autenticación" } },
              tokenInvalido: { summary: "Token inválido o vencido", value: { error: "Token inválido o expirado" } },
            },
          },
        },
      },
      NotSynced: {
        description: "El usuario existe en Firebase pero todavía no se sincronizó con la base de datos",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            examples: { noSincronizado: notSyncedExample },
          },
        },
      },
      InternalError: {
        description: "Error inesperado del servidor",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "Error interno del servidor" },
          },
        },
      },
    },
  },
  paths: {
    ...ratesPaths,
    ...exchangePaths,
    ...summaryPaths,
    ...aliasPaths,
    ...transferPaths,
    "/health": {
      get: {
        tags: ["Health"],
        operationId: "getHealth",
        summary: "Verificar que la API está en línea",
        description: "No requiere autenticación. Sirve para comprobar rápidamente que el servidor responde.",
        security: [],
        responses: {
          "200": {
            description: "La API está funcionando",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: { status: { type: "string", example: "ok" } },
                },
                example: { status: "ok" },
              },
            },
          },
        },
      },
    },
    "/auth/sync": {
      post: {
        tags: ["Auth"],
        operationId: "syncUser",
        summary: "Sincronizar el usuario de Firebase con la base de datos",
        description: [
          "Se llama **después de que el usuario inicia sesión o se registra en Firebase**.",
          "",
          "- Si el usuario **no existe**, lo crea junto con su billetera, un saldo en 0 por cada moneda soportada **y un alias automático**. Responde **201**.",
          "- Si **ya existe**, lo devuelve sin cambios. Responde **200**. Si no tenía nombre y se envía `name`, se lo guarda.",
          "",
          "La operación es idempotente: se puede llamar en cada login sin duplicar datos.",
        ].join("\n"),
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          description: "Opcional. Permite guardar el nombre del usuario al registrarse.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", maxLength: 100, description: "Nombre a mostrar" },
                },
              },
              examples: {
                conNombre: { summary: "Registro con nombre", value: { name: "Dante Cáceres" } },
                sinNombre: { summary: "Login sin datos extra", value: {} },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "El usuario ya existía",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["user", "created"],
                  properties: { user: { $ref: "#/components/schemas/User" }, created: { type: "boolean", example: false } },
                },
                example: { user: exampleUser, created: false },
              },
            },
          },
          "201": {
            description: "Usuario creado junto con su billetera",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["user", "created"],
                  properties: { user: { $ref: "#/components/schemas/User" }, created: { type: "boolean", example: true } },
                },
                example: { user: exampleUser, created: true },
              },
            },
          },
          "400": {
            description: "Datos inválidos o cuenta de Firebase sin email",
            content: {
              "application/json": {
                schema: { oneOf: [{ $ref: "#/components/schemas/ValidationError" }, { $ref: "#/components/schemas/Error" }] },
                examples: {
                  nombreLargo: {
                    summary: "Nombre de más de 100 caracteres",
                    value: {
                      error: "Datos inválidos",
                      details: [{ field: "name", message: "El nombre no puede superar los 100 caracteres" }],
                    },
                  },
                  sinEmail: { summary: "Cuenta sin email", value: { error: "La cuenta no tiene un email asociado" } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/me": {
      get: {
        tags: ["Perfil"],
        operationId: "getMe",
        summary: "Obtener el perfil del usuario autenticado",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Perfil del usuario",
            content: {
              "application/json": {
                schema: { type: "object", required: ["user"], properties: { user: { $ref: "#/components/schemas/User" } } },
                example: { user: exampleUser },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotSynced" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
      patch: {
        tags: ["Perfil"],
        operationId: "updateMe",
        summary: "Actualizar el nombre y/o el alias del usuario autenticado",
        description: [
          "Se puede enviar `name`, `alias` o ambos (al menos uno). Cualquier otro campo devuelve 400.",
          "",
          "Si se envían ambos y el alias no se puede modificar, no se guarda ningún cambio.",
          "",
          aliasRules,
          "",
          "Enviar el mismo alias que ya se tiene no cuenta como modificación.",
        ].join("\n"),
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                minProperties: 1,
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 100 },
                  alias: { type: "string", minLength: 3, maxLength: 30 },
                },
              },
              examples: {
                nombre: { summary: "Cambiar solo el nombre", value: { name: "Dante C." } },
                alias: { summary: "Cambiar solo el alias", value: { alias: "dante.ahorra" } },
                ambos: { summary: "Cambiar nombre y alias", value: { name: "Dante C.", alias: "Dante.Ahorra" } },
                vacio: { summary: "Sin campos (devuelve 400)", value: {} },
                campoExtra: { summary: "Campo no permitido (devuelve 400)", value: { name: "Dante", email: "otro@mail.com" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Usuario actualizado",
            content: {
              "application/json": {
                schema: { type: "object", required: ["user"], properties: { user: { $ref: "#/components/schemas/User" } } },
                example: { user: { ...exampleUser, name: "Dante C." } },
              },
            },
          },
          "400": {
            description: "Datos inválidos",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ValidationError" },
                examples: {
                  vacio: {
                    summary: "Nombre vacío",
                    value: { error: "Datos inválidos", details: [{ field: "name", message: "El nombre no puede estar vacío" }] },
                  },
                  sinCampos: {
                    summary: "Sin name ni alias",
                    value: { error: "Datos inválidos", details: [{ field: "", message: "Enviá al menos name o alias" }] },
                  },
                  aliasInvalido: {
                    summary: "Alias con formato inválido",
                    value: {
                      error: "Datos inválidos",
                      details: [{ field: "alias", message: "El alias solo admite letras, números y puntos, sin puntos al inicio, al final ni seguidos" }],
                    },
                  },
                  campoExtra: {
                    summary: "Campo no permitido",
                    value: { error: "Datos inválidos", details: [{ field: "", message: "Solo se pueden modificar los campos name y alias" }] },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotSynced" },
          "409": {
            description: "El alias ya lo usa otro usuario",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { error: "Ese alias ya está en uso" },
              },
            },
          },
          "422": {
            description: "El alias se modificó hace menos de 24 horas",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { error: "Solo podés modificar tu alias una vez cada 24 horas" },
              },
            },
          },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/users": {
      get: {
        tags: ["Usuarios"],
        operationId: "listUsers",
        summary: "Listar usuarios registrados (paginado y con búsqueda)",
        description: [
          "Devuelve los usuarios ordenados del más nuevo al más antiguo.",
          "",
          "- `search` busca coincidencias parciales en **email** o **nombre**, sin distinguir mayúsculas de minúsculas.",
          "- Por privacidad no se expone el `firebase_uid`.",
        ].join("\n"),
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "page",
            in: "query",
            required: false,
            description: "Número de página (empieza en 1)",
            schema: { type: "integer", minimum: 1, default: 1 },
            example: 1,
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Cantidad de usuarios por página (máximo 100)",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 10 },
            example: 10,
          },
          {
            name: "search",
            in: "query",
            required: false,
            description: "Texto a buscar en email o nombre",
            schema: { type: "string", maxLength: 100 },
            example: "dante",
          },
        ],
        responses: {
          "200": {
            description: "Listado paginado de usuarios",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["users", "pagination"],
                  properties: {
                    users: { type: "array", items: { $ref: "#/components/schemas/UserSummary" } },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
                examples: {
                  conResultados: {
                    summary: "Primera página",
                    value: {
                      users: [
                        { id: "3f8b2c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c", email: "dante@anclalabs.dev", name: "Dante Cáceres", created_at: "2026-11-20T14:32:10.000Z" },
                        { id: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d", email: "kevin@anclalabs.dev", name: "Kevin Prieto", created_at: "2026-11-18T10:05:44.000Z" },
                      ],
                      pagination: { page: 1, limit: 10, total: 2, totalPages: 1 },
                    },
                  },
                  sinResultados: {
                    summary: "Búsqueda sin coincidencias",
                    value: { users: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } },
                  },
                },
              },
            },
          },
          "400": {
            description: "Parámetros de consulta inválidos",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ValidationError" },
                example: { error: "Datos inválidos", details: [{ field: "limit", message: "limit no puede superar 100" }] },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/wallet": {
      get: {
        tags: ["Billetera"],
        operationId: "getWallet",
        summary: "Obtener la billetera del usuario con todos sus saldos",
        description: "Devuelve un saldo por cada moneda soportada (ARS, USD, USDT, BTC), ordenado primero las fiat y después las cripto.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Billetera con saldos",
            content: {
              "application/json": {
                schema: { type: "object", required: ["wallet"], properties: { wallet: { $ref: "#/components/schemas/Wallet" } } },
                example: { wallet: { id: "b7c8d9e0-1f2a-4b3c-9d4e-5f6a7b8c9d0e", balances: exampleBalances } },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotSynced" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/wallet/balances/{currency}": {
      get: {
        tags: ["Billetera"],
        operationId: "getBalanceByCurrency",
        summary: "Obtener el saldo de una moneda",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/CurrencyParam" }],
        responses: {
          "200": {
            description: "Saldo de la moneda pedida",
            content: {
              "application/json": {
                schema: { type: "object", required: ["balance"], properties: { balance: { $ref: "#/components/schemas/Balance" } } },
                example: { balance: exampleBalances[1] },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": {
            description: "Usuario no sincronizado o moneda no soportada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                examples: {
                  noSincronizado: notSyncedExample,
                  monedaNoSoportada: { summary: "Moneda no soportada", value: { error: "Moneda no soportada: EUR" } },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/wallet/deposit": {
      post: {
        tags: ["Billetera"],
        operationId: "createDeposit",
        summary: "Cargar dinero ficticio en ARS o USD",
        description:
          "Suma el monto al saldo y registra la operación en el historial. Límites por carga: 1.000.000 ARS o 1.000 USD. Tope diario (día calendario de Argentina): 100.000.000 ARS o 100.000 USD. Si se repite la misma idempotency_key, devuelve la carga original sin volver a sumar.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/DepositRequest" } } },
        },
        responses: {
          "201": {
            description: "Carga realizada",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["deposit", "replayed"],
                  properties: { deposit: { $ref: "#/components/schemas/Deposit" }, replayed: { type: "boolean", example: false } },
                },
              },
            },
          },
          "200": {
            description: "Carga repetida con la misma idempotency_key: no se volvió a sumar",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["deposit", "replayed"],
                  properties: { deposit: { $ref: "#/components/schemas/Deposit" }, replayed: { type: "boolean", example: true } },
                },
              },
            },
          },
          "400": {
            description: "Datos inválidos (moneda, formato del monto, mínimo/máximo por carga o idempotency_key)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationError" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotSynced" },
          "409": {
            description: "La idempotency_key ya fue usada en otra operación",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description: "Se superó el tope diario de carga",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { error: "Superaste el tope diario de carga de 100.000.000 ARS" },
              },
            },
          },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
  },
};
