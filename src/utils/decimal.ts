import Decimal from "decimal.js";

/**
 * Aritmética decimal exacta para dinero y cotizaciones.
 * Los números de JavaScript (float) pierden precisión: 0.1 + 0.2 = 0.30000000000000004.
 */
export const Dec = Decimal.clone({ precision: 40, toExpNeg: -40, toExpPos: 40 });
export type Dec = InstanceType<typeof Dec>;

/** Redondea a `decimals` decimales y quita los ceros sobrantes ("1455.50000000" → "1455.5"). */
export function formatDecimal(value: Dec, decimals: number): string {
  return value.toDecimalPlaces(decimals, Dec.ROUND_HALF_UP).toString();
}
