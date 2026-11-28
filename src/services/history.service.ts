import { pool } from "../db/pool";
import { ARGENTINA_TIMEZONE } from "./deposit.service";
import { TRANSFER_DAILY_LIMITS } from "./transfer.service";

export const TRANSACTION_TYPES = ["DEPOSIT", "BUY", "SELL", "EXCHANGE", "TRANSFER"] as const;
export const HISTORY_CURRENCIES = ["ARS", "USD", "USDT", "BTC"] as const;

export const AMOUNT_FILTER_RULES: Record<(typeof HISTORY_CURRENCIES)[number], { max: number; decimals: number }> = {
  ARS: { max: TRANSFER_DAILY_LIMITS.ARS, decimals: 2 },
  USD: { max: TRANSFER_DAILY_LIMITS.USD, decimals: 2 },
  USDT: { max: 100_000, decimals: 8 },
  BTC: { max: 10, decimals: 8 },
};

export interface HistoryCursor {
  createdAt: string;
  id: string;
}

export interface HistoryFilters {
  types?: (typeof TRANSACTION_TYPES)[number][];
  currency?: (typeof HISTORY_CURRENCIES)[number];
  direction?: "sent" | "received";
  flow?: "in" | "out";
  from?: string;
  to?: string;
  minAmount?: string;
  maxAmount?: string;
  limit: number;
  cursor?: HistoryCursor;
}

interface MovementSide {
  currency: string;
  amount: string;
  balance_after: string;
}

export interface HistoryItem {
  id: string;
  type: string;
  direction: "sent" | "received" | null;
  from: MovementSide | null;
  to: MovementSide | null;
  rate: string | null;
  counterparty: { name: string | null; alias: string } | null;
  created_at: Date;
}

interface HistoryRow {
  id: string;
  type: string;
  direction: "sent" | "received" | null;
  from_currency: string | null;
  from_amount: string | null;
  from_balance_after: string | null;
  to_currency: string | null;
  to_amount: string | null;
  to_balance_after: string | null;
  rate: string | null;
  counterparty_name: string | null;
  counterparty_alias: string | null;
  created_at: Date;
  cursor_created_at: string;
}

const CURSOR_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): HistoryCursor | null {
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (parts.length !== 2 || !CURSOR_DATE.test(parts[0]) || !UUID.test(parts[1])) {
    return null;
  }
  return { createdAt: parts[0], id: parts[1] };
}

function side(currency: string | null, amount: string | null, balanceAfter: string | null): MovementSide | null {
  if (currency === null || amount === null || balanceAfter === null) {
    return null;
  }
  return { currency, amount, balance_after: balanceAfter };
}

export async function listTransactions(
  firebaseUid: string,
  filters: HistoryFilters
): Promise<{ transactions: HistoryItem[]; next_cursor: string | null } | null> {
  const wallet = await pool.query<{ id: string }>(
    "SELECT w.id FROM wallets w JOIN users u ON u.id = w.user_id WHERE u.firebase_uid = $1",
    [firebaseUid]
  );
  const walletId = wallet.rows[0]?.id;
  if (!walletId) {
    return null;
  }

  const result = await pool.query<HistoryRow>(
    `SELECT t.id, t.type::text AS type,
            CASE WHEN t.type = 'TRANSFER' THEN CASE WHEN t.from_currency IS NULL THEN 'received' ELSE 'sent' END END AS direction,
            t.from_currency,
            TRUNC(t.from_amount, fc.decimals)::text AS from_amount,
            TRUNC(t.from_balance_after, fc.decimals)::text AS from_balance_after,
            t.to_currency,
            TRUNC(t.to_amount, tc.decimals)::text AS to_amount,
            TRUNC(t.to_balance_after, tc.decimals)::text AS to_balance_after,
            trim_scale(t.rate)::text AS rate,
            cu.name AS counterparty_name, cu.alias AS counterparty_alias,
            t.created_at,
            to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
     FROM transactions t
     LEFT JOIN currencies fc ON fc.code = t.from_currency
     LEFT JOIN currencies tc ON tc.code = t.to_currency
     LEFT JOIN wallets cw ON cw.id = t.counterparty_wallet_id
     LEFT JOIN users cu ON cu.id = cw.user_id
     WHERE t.wallet_id = $1
       AND ($2::text[] IS NULL OR t.type::text = ANY($2::text[]))
       AND ($3::text IS NULL OR t.from_currency = $3::text OR t.to_currency = $3::text)
       AND ($4::text IS NULL OR (t.type = 'TRANSFER' AND (t.from_currency IS NOT NULL) = ($4::text = 'sent')))
       AND ($5::date IS NULL OR t.created_at >= ($5::date::timestamp AT TIME ZONE $7))
       AND ($6::date IS NULL OR t.created_at < (($6::date + 1)::timestamp AT TIME ZONE $7))
       AND ($8::timestamptz IS NULL OR (t.created_at, t.id) < ($8::timestamptz, $9::uuid))
       AND ($11::numeric IS NULL OR (t.from_currency = $3::text AND t.from_amount >= $11::numeric) OR (t.to_currency = $3::text AND t.to_amount >= $11::numeric))
       AND ($12::numeric IS NULL OR (t.from_currency = $3::text AND t.from_amount <= $12::numeric) OR (t.to_currency = $3::text AND t.to_amount <= $12::numeric))
       AND ($13::text IS NULL OR ($13::text = 'in' AND t.from_currency IS NULL) OR ($13::text = 'out' AND t.to_currency IS NULL))
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $10`,
    [
      walletId,
      filters.types ?? null,
      filters.currency ?? null,
      filters.direction ?? null,
      filters.from ?? null,
      filters.to ?? null,
      ARGENTINA_TIMEZONE,
      filters.cursor?.createdAt ?? null,
      filters.cursor?.id ?? null,
      filters.limit + 1,
      filters.minAmount ?? null,
      filters.maxAmount ?? null,
      filters.flow ?? null,
    ]
  );

  const hasMore = result.rows.length > filters.limit;
  const page = hasMore ? result.rows.slice(0, filters.limit) : result.rows;
  const last = page[page.length - 1];

  return {
    transactions: page.map((row) => ({
      id: row.id,
      type: row.type,
      direction: row.direction,
      from: side(row.from_currency, row.from_amount, row.from_balance_after),
      to: side(row.to_currency, row.to_amount, row.to_balance_after),
      rate: row.rate,
      counterparty: row.counterparty_alias ? { name: row.counterparty_name, alias: row.counterparty_alias } : null,
      created_at: row.created_at,
    })),
    next_cursor: hasMore ? encodeCursor(last.cursor_created_at, last.id) : null,
  };
}
