import { pool } from "../db/pool";

export interface Balance {
  currency_code: string;
  name: string;
  type: "fiat" | "crypto";
  decimals: number;
  amount: string;
  updated_at: Date;
}

export interface Wallet {
  id: string;
  balances: Balance[];
}

export async function getWalletByFirebaseUid(firebaseUid: string): Promise<Wallet | null> {
  const result = await pool.query<Balance & { wallet_id: string }>(
    `SELECT w.id AS wallet_id, b.currency_code, c.name, c.type, c.decimals,
            TRUNC(b.amount, c.decimals)::text AS amount, b.updated_at
     FROM users u
     JOIN wallets w ON w.user_id = u.id
     JOIN balances b ON b.wallet_id = w.id
     JOIN currencies c ON c.code = b.currency_code
     WHERE u.firebase_uid = $1
     ORDER BY c.type, c.decimals, c.code`,
    [firebaseUid]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    id: result.rows[0].wallet_id,
    balances: result.rows.map(({ wallet_id, ...balance }) => balance),
  };
}
