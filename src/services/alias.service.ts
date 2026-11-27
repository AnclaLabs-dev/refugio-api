import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db/pool";

const ALIAS_PATTERN = /^[a-z0-9]+(\.[a-z0-9]+)*$/;

export const aliasSchema = z
  .string({ error: "El alias es obligatorio" })
  .trim()
  .toLowerCase()
  .min(3, "El alias debe tener al menos 3 caracteres")
  .max(30, "El alias no puede superar los 30 caracteres")
  .regex(ALIAS_PATTERN, "El alias solo admite letras, números y puntos, sin puntos al inicio, al final ni seguidos");

export interface PublicProfile {
  name: string | null;
  alias: string;
}

export class AliasTakenError extends Error {}

export class AliasCooldownError extends Error {}

export function isAliasConflict(err: unknown): boolean {
  if (err instanceof AliasTakenError) {
    return true;
  }
  const pgError = err as { code?: string; constraint?: string };
  return pgError.code === "23505" && pgError.constraint === "users_alias_key";
}

function aliasBase(name: string | null, email: string): string {
  const base = (name || email.split("@")[0])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .slice(0, 21)
    .replace(/^\.+|\.+$/g, "");
  return base || "usuario";
}

export async function pickFreeAlias(client: PoolClient, name: string | null, email: string): Promise<string> {
  const base = aliasBase(name, email);
  const candidates = [`${base}.refugio`, ...[1, 2, 3].map(() => `${base}.${randomInt(1000, 10000)}`)];

  const result = await client.query<{ alias: string }>(
    `SELECT c.alias
     FROM unnest($1::text[]) WITH ORDINALITY AS c(alias, position)
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.alias = c.alias)
     ORDER BY c.position
     LIMIT 1`,
    [candidates]
  );

  const alias = result.rows[0]?.alias;
  if (!alias) {
    throw new AliasTakenError("No se pudo generar un alias libre");
  }
  return alias;
}

export async function findPublicProfileByAlias(alias: string): Promise<PublicProfile | null> {
  const result = await pool.query<PublicProfile>("SELECT name, alias FROM users WHERE alias = $1", [alias]);
  return result.rows[0] ?? null;
}
