type TokenReservation = {
  at: number;
  tokens: number;
};

const ONE_MINUTE_MS = 60_000;

export function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function parseRetryDelayMs(error: unknown): number | undefined {
  const headers = (
    error as { headers?: Headers | Record<string, string> } | null
  )?.headers;
  const retryAfterMs = readHeader(headers, "retry-after-ms");
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const retryAfter = readHeader(headers, "retry-after");
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }

  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(
    /try again in\s+([\d.]+)\s*(ms|milliseconds?|s|seconds?|m|minutes?)/i,
  );
  if (!match) return undefined;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;

  const unit = match[2].toLowerCase();
  if (unit.startsWith("m") && unit !== "ms" && !unit.startsWith("milli")) {
    return value * 60_000;
  }
  if (unit.startsWith("s")) return value * 1000;
  return value;
}

export function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (status === 429) return true;

  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b/.test(message) && /rate limit/i.test(message);
}

export class TokenWindow {
  private reservations: TokenReservation[] = [];

  constructor(private readonly maxTokensPerMinute: number) {}

  async reserve(tokens: number): Promise<number> {
    if (!Number.isFinite(tokens) || tokens <= 0) return 0;

    while (true) {
      const now = Date.now();
      this.prune(now);

      const used = this.reservations.reduce((sum, item) => sum + item.tokens, 0);
      if (
        used + tokens <= this.maxTokensPerMinute ||
        this.reservations.length === 0
      ) {
        this.reservations.push({ at: now, tokens });
        return 0;
      }

      const waitMs = Math.max(0, this.reservations[0].at + ONE_MINUTE_MS - now);
      await sleep(waitMs + 25);
    }
  }

  private prune(now: number) {
    while (
      this.reservations.length > 0 &&
      now - this.reservations[0].at >= ONE_MINUTE_MS
    ) {
      this.reservations.shift();
    }
  }
}

export class RetryCooldown {
  private nextAttemptAt = 0;

  async wait() {
    const waitMs = this.nextAttemptAt - Date.now();
    if (waitMs > 0) await sleep(waitMs);
  }

  delay(ms: number) {
    this.nextAttemptAt = Math.max(this.nextAttemptAt, Date.now() + ms);
  }
}

export async function retryRateLimited<T>(
  fn: () => Promise<T>,
  options: {
    label: string;
    maxAttempts: number;
    cooldown: RetryCooldown;
    reserveTokens?: () => Promise<number>;
    onRetry?: (message: string) => void;
  },
): Promise<T> {
  let attempt = 0;

  while (true) {
    attempt++;
    await options.cooldown.wait();
    await options.reserveTokens?.();

    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= options.maxAttempts) {
        throw error;
      }

      const retryDelay = parseRetryDelayMs(error);
      const exponentialDelay = Math.min(30_000, 500 * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 250);
      const waitMs = Math.max(retryDelay ?? 0, exponentialDelay) + jitter;
      options.cooldown.delay(waitMs);
      const maxRetries = options.maxAttempts - 1;
      options.onRetry?.(
        `  rate limited while embedding ${options.label}; retry ${attempt}/${maxRetries} in ${formatDuration(waitMs)}`,
      );
    }
  }
}

function readHeader(
  headers: Headers | Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string>;
  return (
    record[name] ??
    record[name.toLowerCase()] ??
    record[name.toUpperCase()]
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
