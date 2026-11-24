import { pool } from "../db/pool";

export interface User {
  id: string;
  firebase_uid: string;
  email: string;
  name: string | null;
  created_at: Date;
}

export async function findUserByFirebaseUid(firebaseUid: string): Promise<User | null> {
  const result = await pool.query<User>(
    "SELECT id, firebase_uid, email, name, created_at FROM users WHERE firebase_uid = $1",
    [firebaseUid]
  );
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted = await client.query<User>(
      `INSERT INTO users (firebase_uid, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (firebase_uid) DO NOTHING
       RETURNING id, firebase_uid, email, name, created_at`,
      [firebaseUid, email, name]
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
    "UPDATE users SET name = $1 WHERE firebase_uid = $2 RETURNING id, firebase_uid, email, name, created_at",
    [name, firebaseUid]
  );
  return result.rows[0] ?? null;
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
