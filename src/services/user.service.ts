import { pool } from "../db/pool";
import { AliasCooldownError, AliasTakenError, isAliasConflict, pickFreeAlias } from "./alias.service";

const USER_COLUMNS = "id, firebase_uid, email, name, alias, alias_updated_at, created_at";

export interface User {
  id: string;
  firebase_uid: string;
  email: string;
  name: string | null;
  alias: string;
  alias_updated_at: Date | null;
  created_at: Date;
}

export async function findUserByFirebaseUid(firebaseUid: string): Promise<User | null> {
  const result = await pool.query<User>(`SELECT ${USER_COLUMNS} FROM users WHERE firebase_uid = $1`, [firebaseUid]);
  return result.rows[0] ?? null;
}

export async function syncUser(firebaseUid: string, email: string, name: string | null): Promise<{ user: User; created: boolean }> {
  const existing = await findUserByFirebaseUid(firebaseUid);
  if (existing) {
    if (existing.name === null && name) {
      const updated = await updateUserName(firebaseUid, name);
      return { user: updated ?? existing, created: false };
    }
    return { user: existing, created: false };
  }

  for (let attempt = 1; ; attempt++) {
    try {
      return await createUserWithWallet(firebaseUid, email, name);
    } catch (err) {
      if (attempt < 3 && isAliasConflict(err)) {
        continue;
      }
      throw err;
    }
  }
}

async function createUserWithWallet(firebaseUid: string, email: string, name: string | null): Promise<{ user: User; created: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const alias = await pickFreeAlias(client, name, email);

    const inserted = await client.query<User>(
      `INSERT INTO users (firebase_uid, email, name, alias)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (firebase_uid) DO NOTHING
       RETURNING ${USER_COLUMNS}`,
      [firebaseUid, email, name, alias]
    );

    const user = inserted.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      const concurrent = await findUserByFirebaseUid(firebaseUid);
      if (!concurrent) {
        throw new Error("No se pudo sincronizar el usuario");
      }
      return { user: concurrent, created: false };
    }

    const wallet = await client.query<{ id: string }>(
      "INSERT INTO wallets (user_id) VALUES ($1) RETURNING id",
      [user.id]
    );

    await client.query(
      "INSERT INTO balances (wallet_id, currency_code) SELECT $1::uuid, code FROM currencies",
      [wallet.rows[0].id]
    );

    await client.query("COMMIT");
    return { user, created: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateUserName(firebaseUid: string, name: string): Promise<User | null> {
  const result = await pool.query<User>(
    `UPDATE users SET name = $1 WHERE firebase_uid = $2 RETURNING ${USER_COLUMNS}`,
    [name, firebaseUid]
  );
  return result.rows[0] ?? null;
}

export async function updateProfile(firebaseUid: string, changes: { name?: string; alias?: string }): Promise<User | null> {
  try {
    const result = await pool.query<User>(
      `UPDATE users
       SET name = COALESCE($2::text, name),
           alias = COALESCE($3::text, alias),
           alias_updated_at = CASE WHEN $3::text IS NOT NULL AND $3::text <> alias THEN now() ELSE alias_updated_at END
       WHERE firebase_uid = $1
         AND ($3::text IS NULL OR $3::text = alias OR alias_updated_at IS NULL OR alias_updated_at <= now() - interval '24 hours')
       RETURNING ${USER_COLUMNS}`,
      [firebaseUid, changes.name ?? null, changes.alias ?? null]
    );

    if (result.rows[0]) {
      return result.rows[0];
    }
    if (await findUserByFirebaseUid(firebaseUid)) {
      throw new AliasCooldownError("Solo podés modificar tu alias una vez cada 24 horas");
    }
    return null;
  } catch (err) {
    if (isAliasConflict(err)) {
      throw new AliasTakenError("Ese alias ya está en uso");
    }
    throw err;
  }
}

export interface UserSummary {
  id: string;
  email: string;
  name: string | null;
  created_at: Date;
}

export interface ListUsersParams {
  page: number;
  limit: number;
  search?: string;
}

export async function listUsers({ page, limit, search }: ListUsersParams): Promise<{ users: UserSummary[]; total: number }> {
  const term = search ? `%${search}%` : null;
  const where = "WHERE ($1::text IS NULL OR email ILIKE $1 OR name ILIKE $1)";

  const [rows, count] = await Promise.all([
    pool.query<UserSummary>(
      `SELECT id, email, name, created_at FROM users ${where}
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [term, limit, (page - 1) * limit]
    ),
    pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM users ${where}`, [term]),
  ]);

  return { users: rows.rows, total: count.rows[0].total };
}
