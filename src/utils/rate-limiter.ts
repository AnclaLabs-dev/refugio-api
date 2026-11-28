/**
 * Límite de pedidos por usuario en memoria (ventanas de 1 minuto y 1 día).
 * Suficiente para una sola instancia del servidor. Con varias instancias habría que guardarlo en la base o en Redis.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly perMinute: number,
    private readonly perDay: number
  ) {}

  /** Registra un pedido. Devuelve los segundos a esperar si se pasó del límite, o 0 si está permitido. */
  hit(key: string, now = Date.now()): number {
    const DAY = 24 * 60 * 60 * 1000;
    const MINUTE = 60 * 1000;

    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < DAY);
    const lastMinute = recent.filter((t) => now - t < MINUTE);

    if (lastMinute.length >= this.perMinute) {
      this.hits.set(key, recent);
      return Math.ceil((MINUTE - (now - lastMinute[0])) / 1000);
    }
    if (recent.length >= this.perDay) {
      this.hits.set(key, recent);
      return Math.ceil((DAY - (now - recent[0])) / 1000);
    }

    recent.push(now);
    this.hits.set(key, recent);
    return 0;
  }
}
