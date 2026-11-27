import { randomUUID } from "node:crypto";
import { pool } from "../db/pool";
import { ARGENTINA_TIMEZONE, DEPOSIT_LIMITS, type DepositCurrency } from "./deposit.service";

export type TransferCurrency = DepositCurrency;

export const TRANSFER_DAILY_LIMITS: Record<TransferCurrency, number> = {
  ARS: DEPOSIT_LIMITS.ARS.daily,
  USD: DEPOSIT_LIMITS.USD.daily,
};

export interface Transfer {
  id: string;
  direction: "sent";
  currency: TransferCurrency;
  amount: string;
  balance_after: string;
  counterparty: { name: string | null; alias: string };
  idempotency_key: string;
  created_at: Date;
}

export class TransferError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface PreviousOperation {
  id: string;
  wallet_id: string;
  type: string;
  from_currency: string | null;
  counterparty_wallet_id: string | null;
  same_amount: boolean | null;
  amount: string;
  balance_after: string;
  idempotency_key: string;
  created_at: Date;
  name: string | null;
  alias: string;
}

export async function createTransfer(
  firebaseUid: string,
  toAlias: string,
  currency: TransferCurrency,
  amount: string,
  idempotencyKey: string
): Promise<{ transfer: Transfer; replayed: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sender = await client.query<{ wallet_id: string }>(
      "SELECT w.id AS wallet_id FROM wallets w JOIN users u ON u.id = w.user_id WHERE u.firebase_uid = $1",
      [firebaseUid]
    );
    const senderWalletId = sender.rows[0]?.wallet_id;
    if (!senderWalletId) {
      throw new TransferError(404, "Usuario no sincronizado, llama primero a POST /auth/sync");
    }

    const recipientResult = await client.query<{ wallet_id: string; name: string | null; alias: string }>(
      "SELECT w.id AS wallet_id, u.name, u.alias FROM wallets w JOIN users u ON u.id = w.user_id WHERE u.alias = $1",
      [toAlias]
    );
    const recipient = recipientResult.rows[0];
    if (!recipient) {
      throw new TransferError(404, "No existe ningún usuario con ese alias");
    }
    if (recipient.wallet_id === senderWalletId) {
      throw new TransferError(422, "No se puede transferir a la propia cuenta");
    }

    const locked = await client.query<{ wallet_id: string; available: string }>(
      `SELECT wallet_id, TRUNC(amount, 2)::text AS available
       FROM balances
       WHERE wallet_id IN ($1, $2) AND currency_code = $3
       ORDER BY wallet_id, currency_code
       FOR UPDATE`,
      [senderWalletId, recipient.wallet_id, currency]
    );

    const previous = await client.query<PreviousOperation>(
      `SELECT t.id, t.wallet_id, t.type::text AS type, t.from_currency, t.counterparty_wallet_id,
              t.from_amount = $2::numeric AS same_amount,
              TRUNC(t.from_amount, 2)::text AS amount, TRUNC(t.from_balance_after, 2)::text AS balance_after,
              t.idempotency_key, t.created_at, u.name, u.alias
       FROM transactions t
       LEFT JOIN wallets w ON w.id = t.counterparty_wallet_id
       LEFT JOIN users u ON u.id = w.user_id
       WHERE t.idempotency_key = $1`,
      [idempotencyKey, amount]
    );

    const existing = previous.rows[0];
    if (existing) {
      if (existing.wallet_id !== senderWalletId || existing.type !== "TRANSFER" || existing.from_currency === null) {
        throw new TransferError(409, "La idempotency_key ya fue usada en otra operación");
      }
      if (existing.from_currency !== currency || !existing.same_amount || existing.counterparty_wallet_id !== recipient.wallet_id) {
        throw new TransferError(422, "La idempotency_key ya se usó en una transferencia con otros datos");
      }
      await client.query("ROLLBACK");
      return {
        transfer: {
          id: existing.id,
          direction: "sent",
          currency,
          amount: existing.amount,
          balance_after: existing.balance_after,
          counterparty: { name: existing.name, alias: existing.alias },
          idempotency_key: existing.idempotency_key,
          created_at: existing.created_at,
        },
        replayed: true,
      };
    }

    const daily = await client.query<{ exceeds: boolean }>(
      `SELECT COALESCE(SUM(from_amount), 0) + $3::numeric > $4::numeric AS exceeds
       FROM transactions
       WHERE wallet_id = $1
         AND type = 'TRANSFER'
         AND from_currency = $2
         AND created_at >= date_trunc('day', now() AT TIME ZONE $5) AT TIME ZONE $5`,
      [senderWalletId, currency, amount, TRANSFER_DAILY_LIMITS[currency], ARGENTINA_TIMEZONE]
    );

    if (daily.rows[0].exceeds) {
      const limit = TRANSFER_DAILY_LIMITS[currency].toLocaleString("es-AR");
      throw new TransferError(422, `Superaste el tope diario de transferencias de ${limit} ${currency}`);
    }

    const debited = await client.query<{ amount: string }>(
      `UPDATE balances SET amount = amount - $1::numeric, updated_at = now()
       WHERE wallet_id = $2 AND currency_code = $3 AND amount >= $1::numeric
       RETURNING amount::text`,
      [amount, senderWalletId, currency]
    );

    if (debited.rowCount === 0) {
      const available = locked.rows.find((row) => row.wallet_id === senderWalletId)?.available ?? "0.00";
      throw new TransferError(422, `Saldo insuficiente: tenés ${available} ${currency}`);
    }

    const credited = await client.query<{ amount: string }>(
      `UPDATE balances SET amount = amount + $1::numeric, updated_at = now()
       WHERE wallet_id = $2 AND currency_code = $3
       RETURNING amount::text`,
      [amount, recipient.wallet_id, currency]
    );

    const transferId = randomUUID();

    const sent = await client.query<{ id: string; amount: string; balance_after: string; created_at: Date }>(
      `INSERT INTO transactions (wallet_id, type, from_currency, from_amount, from_balance_after, counterparty_wallet_id, transfer_id, idempotency_key)
       VALUES ($1, 'TRANSFER', $2, $3, $4, $5, $6, $7)
       RETURNING id, TRUNC(from_amount, 2)::text AS amount, TRUNC(from_balance_after, 2)::text AS balance_after, created_at`,
      [senderWalletId, currency, amount, debited.rows[0].amount, recipient.wallet_id, transferId, idempotencyKey]
    );

    await client.query(
      `INSERT INTO transactions (wallet_id, type, to_currency, to_amount, to_balance_after, counterparty_wallet_id, transfer_id, idempotency_key)
       VALUES ($1, 'TRANSFER', $2, $3, $4, $5, $6, $7)`,
      [recipient.wallet_id, currency, amount, credited.rows[0].amount, senderWalletId, transferId, randomUUID()]
    );

    await client.query("COMMIT");

    const row = sent.rows[0];
    return {
      transfer: {
        id: row.id,
        direction: "sent",
        currency,
        amount: row.amount,
        balance_after: row.balance_after,
        counterparty: { name: recipient.name, alias: recipient.alias },
        idempotency_key: idempotencyKey,
        created_at: row.created_at,
      },
      replayed: false,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    if ((err as { code?: string }).code === "23505") {
      throw new TransferError(409, "La idempotency_key ya fue usada en otra operación");
    }
    throw err;
  } finally {
    client.release();
  }
}
