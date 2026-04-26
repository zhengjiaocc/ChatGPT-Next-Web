type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

const buckets = new Map<string, RateLimitBucket>();
const upstashLimiters = new Map<string, any>();
let upstashAvailable: boolean | undefined;

function now() {
  return Date.now();
}

function gc(expiredBefore: number) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= expiredBefore) {
      buckets.delete(key);
    }
  }
}

function consumeInMemory(options: RateLimitOptions): RateLimitResult {
  const { key, limit, windowMs } = options;
  const current = now();
  const bucket = buckets.get(key);

  // Opportunistic cleanup to avoid unbounded growth.
  if (buckets.size > 5000) {
    gc(current);
  }

  if (!bucket || bucket.resetAt <= current) {
    buckets.set(key, {
      count: 1,
      resetAt: current + windowMs,
    });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterMs: 0,
    };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, bucket.resetAt - current),
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterMs: 0,
  };
}

function getUpstashLimiter(limit: number, windowMs: number) {
  if (upstashAvailable === false) return null;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    upstashAvailable = false;
    return null;
  }
  upstashAvailable = true;
  const key = `${limit}:${windowMs}`;
  const cached = upstashLimiters.get(key);
  if (cached) return cached;
  const { Redis } = require("@upstash/redis");
  const { Ratelimit } = require("@upstash/ratelimit");
  const redis = new Redis({ url, token });
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(limit, `${Math.max(1, windowMs / 1000)} s`),
    analytics: true,
    prefix: "nonechat:ratelimit",
  });
  upstashLimiters.set(key, limiter);
  return limiter;
}

export async function consumeRateLimit(options: RateLimitOptions) {
  const limiter = getUpstashLimiter(options.limit, options.windowMs);
  if (!limiter) return consumeInMemory(options);
  try {
    const result = await limiter.limit(options.key);
    return {
      allowed: result.success,
      remaining: result.remaining,
      retryAfterMs: result.reset ? Math.max(0, result.reset - Date.now()) : 0,
    };
  } catch {
    // Fail open to in-memory limiter if remote limiter is temporarily unavailable.
    return consumeInMemory(options);
  }
}

export function getRequestIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}
