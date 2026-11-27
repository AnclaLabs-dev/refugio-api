import { pool } from "../db/pool";

export type DepositCurrency = "ARS" | "USD";

export const DEPOSIT_LIMITS: Record<DepositCurrency, { perDeposit: number; daily: number }> = {
  ARS: { perDeposit: 1_000_000, daily: 100_000_000 },
  USD: { perDeposit: 1_000, daily: 100_000 },
};

export const ARGENTINA_TIMEZONE ="America/Argentina/Buenos_Aires";

const DEPOSIT_COLUMNS = `id, type, to_currency AS currency, TRUNC(to_amount, 2)::text AS amount,
  TRUNC(to_balance_after, 2)::text AS balance_after, idempotency_key, email_status, created_at`;

export interface Deposit {
  id: string;
  type: "DEPOSIT";
  currency: DepositCurrency;
  amount: string;
  balance_after: string;
  idempotency_key: string;
  email_status: "PENDING" | "SENT" | "FAILED";
  created_at: Date;
}

export class DepositError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function createDeposit(
  firebaseUid: string,
  currency: DepositCurrency,
  amount: string,
  idempotencyKey: string
): Promise<{ deposit: Deposit; replayed: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const locked = await client.query<{ wallet_id: string }>(
      `SELECT b.wallet_id
       FROM balances b
       JOIN wallets w ON w.id = b.wallet_id
       JOIN users u ON u.id = w.user_id
       WHERE u.firebase_uid = $1 AND b.currency_code = $2
       FOR UPDATE OF b`,
      [firebaseUid, currency]
    );

    const walletId = locked.rows[0]?.wallet_id;
    if (!walletId) {
      throw new DepositError(404, "Usuario no sincronizado, llama primero a POST /auth/sync");
    }

    const previous = await client.query<Deposit & { wallet_id: string }>(
      `SELECT ${DEPOSIT_COLUMNS}, wallet_id FROM transactions WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    const existing = previous.rows[0];
    if (existing) {
      if (existing.wallet_id !== walletId || existing.type !== "DEPOSIT") {
        throw new DepositError(409, "La idempotency_key ya fue usada en otra operación");
      }
      await client.query("ROLLBACK");
      const { wallet_id, ...deposit } = existing;
      return { deposit, replayed: true };
    }

    const daily = await client.query<{ exceeds: boolean }>(
      `SELECT COALESCE(SUM(to_amount), 0) + $3::numeric > $4::numeric AS exceeds
       FROM transactions
       WHERE wallet_id = $1
         AND type = 'DEPOSIT'
         AND to_currency = $2
         AND created_at >= date_trunc('day', now() AT TIME ZONE $5) AT TIME ZONE $5`,
      [walletId, currency, amount, DEPOSIT_LIMITS[currency].daily, ARGENTINA_TIMEZONE]
    );

    if (daily.rows[0].exceeds) {
      const limit = DEPOSIT_LIMITS[currency].daily.toLocaleString("es-AR");
      throw new DepositError(422, `Superaste el tope diario de carga de ${limit} ${currency}`);
    }

    const balance = await client.query<{ amount: string }>(
      `UPDATE balances SET amount = amount + $1::numeric, updated_at = now()
       WHERE wallet_id = $2 AND currency_code = $3
       RETURNING amount`,
      [amount, walletId, currency]
    );

    const inserted = await client.query<Deposit>(
      `INSERT INTO transactions (wallet_id, type, to_currency, to_amount, to_balance_after, idempotency_key)
       VALUES ($1, 'DEPOSIT', $2, $3, $4, $5)
       RETURNING ${DEPOSIT_COLUMNS}`,
      [walletId, currency, amount, balance.rows[0].amount, idempotencyKey]
    );

    await client.query("COMMIT");
    return { deposit: inserted.rows[0], replayed: false };
  } catch (err) {
    await client.query("ROLLBACK");
    if ((err as { code?: string }).code === "23505") {
      throw new DepositError(409, "La idempotency_key ya fue usada en otra operación");
    }
    throw err;
  } finally {
    client.release();
  }
}
