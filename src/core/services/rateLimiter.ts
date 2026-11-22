import type { IClock } from '../abstractions/IClock';

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly clock: IClock;
  private readonly defaultMaxRequests: number;
  private readonly defaultWindowMs: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(
    clock: IClock,
    defaultMaxRequests = 10,
    defaultWindowMs = 60 * 1000,
  ) {
    this.clock = clock;
    this.defaultMaxRequests = defaultMaxRequests;
    this.defaultWindowMs = defaultWindowMs;
  }

  public consume(
    key: string,
    maxRequests = this.defaultMaxRequests,
    windowMs = this.defaultWindowMs,
  ): RateLimitCheckResult {
    const nowMs = this.clock.now().getTime();
    const cutoffMs = nowMs - windowMs;

    const existing = this.buckets.get(key) ?? [];
    const activeTimestamps = existing.filter((ts) => ts > cutoffMs);

    if (activeTimestamps.length >= maxRequests) {
      const oldestTs = activeTimestamps[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldestTs + windowMs - nowMs) / 1000),
      );
      this.buckets.set(key, activeTimestamps);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    activeTimestamps.push(nowMs);
    this.buckets.set(key, activeTimestamps);

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - activeTimestamps.length),
      retryAfterSeconds: 0,
    };
  }

  public reset(key?: string): void {
    if (typeof key === 'string') {
      this.buckets.delete(key);
      return;
    }
    this.buckets.clear();
  }
}
