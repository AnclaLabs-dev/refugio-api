const examplePublicProfile = { name: "Dante Cáceres", alias: "dante.caceres.refugio" };

const aliasValidationError = (message: string) => ({
  error: "Datos inválidos",
  details: [{ field: "alias", message }],
});

export const aliasTag = { name: "Alias", description: "Alias único de cada usuario, para recibir transferencias" };

export const aliasSchemas = {
  PublicProfile: {
    type: "object",
    description: "Datos visibles de otro usuario. Nunca incluye el email ni los saldos.",
    required: ["name", "alias"],
    properties: {
      name: { type: "string", nullable: true },
      alias: { type: "string", example: "dante.caceres.refugio" },
    },
    example: examplePublicProfile,
  },
};

export const aliasRules = [
  "Reglas del alias:",
  "- Entre **3 y 30** caracteres.",
  "- Solo letras `a-z`, números y puntos. Sin puntos al inicio, al final ni seguidos.",
  "- **No distingue mayúsculas**: se guarda siempre en minúsculas.",
  "- Se puede modificar **una vez cada 24 horas**. El alias automático del registro no cuenta como modificación.",
].join("\n");

export const aliasPaths = {
  "/aliases/{alias}": {
    get: {
      tags: ["Alias"],
      operationId: "getProfileByAlias",
      summary: "Buscar un usuario por su alias",
      description: [
        "Se usa antes de transferir, para mostrar **a quién** se le va a enviar dinero y que el usuario confirme.",
        "",
        "Solo devuelve `name` y `alias`: **nunca** el email ni los saldos.",
      ].join("\n"),
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "alias",
          in: "path",
          required: true,
          description: "Alias a buscar. No distingue mayúsculas.",
          schema: { type: "string" },
          examples: {
            valido: { value: "dante.caceres.refugio", summary: "Alias existente" },
            mayusculas: { value: "Dante.Caceres.Refugio", summary: "En mayúsculas (también funciona)" },
          },
        },
      ],
      responses: {
        "200": {
          description: "Usuario encontrado",
          content: {
            "application/json": {
              schema: { type: "object", required: ["profile"], properties: { profile: { $ref: "#/components/schemas/PublicProfile" } } },
              example: { profile: examplePublicProfile },
            },
          },
        },
        "400": {
          description: "El alias no tiene un formato válido",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationError" },
              example: aliasValidationError("El alias debe tener al menos 3 caracteres"),
            },
          },
        },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "404": {
          description: "No hay ningún usuario con ese alias",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: { error: "No existe ningún usuario con ese alias" },
            },
          },
        },
        "500": { $ref: "#/components/responses/InternalError" },
      },
    },
  },
};
