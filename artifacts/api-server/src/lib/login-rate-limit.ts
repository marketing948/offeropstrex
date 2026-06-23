import type { Request } from "express";

type AttemptEntry = {
  failures: number;
  windowStartedAt: number;
};

const attempts = new Map<string, AttemptEntry>();

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

function maxFailures(): number {
  const n = Number(process.env.LOGIN_RATE_LIMIT_MAX);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_FAILURES;
}

function windowMs(): number {
  const n = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WINDOW_MS;
}

export function isLoginRateLimitEnabled(): boolean {
  if (process.env.LOGIN_RATE_LIMIT_DISABLED === "true") return false;
  if (process.env.NODE_ENV === "test") return false;
  return true;
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function attemptKey(ip: string, email: string): string {
  return `${ip}:${email.trim().toLowerCase()}`;
}

function getEntry(key: string): AttemptEntry {
  const now = Date.now();
  const existing = attempts.get(key);
  if (!existing || now - existing.windowStartedAt >= windowMs()) {
    const fresh = { failures: 0, windowStartedAt: now };
    attempts.set(key, fresh);
    return fresh;
  }
  return existing;
}

export function isLoginRateLimited(ip: string, email: string): boolean {
  if (!isLoginRateLimitEnabled()) return false;
  const entry = getEntry(attemptKey(ip, email));
  return entry.failures >= maxFailures();
}

export function recordFailedLogin(ip: string, email: string): void {
  if (!isLoginRateLimitEnabled()) return;
  const key = attemptKey(ip, email);
  const entry = getEntry(key);
  entry.failures += 1;
  attempts.set(key, entry);
}

export function clearLoginAttempts(ip: string, email: string): void {
  attempts.delete(attemptKey(ip, email));
}

/** Clear all rate-limit buckets for an email (any IP). Used after admin remediation. */
export function clearLoginAttemptsForEmail(email: string): number {
  const normalized = email.trim().toLowerCase();
  let cleared = 0;
  for (const key of [...attempts.keys()]) {
    if (key.endsWith(`:${normalized}`)) {
      attempts.delete(key);
      cleared += 1;
    }
  }
  return cleared;
}

export function getLoginRateLimitInfo(
  ip: string,
  email: string,
): { limited: boolean; retryAfterSeconds: number } {
  if (!isLoginRateLimitEnabled()) return { limited: false, retryAfterSeconds: 0 };
  const key = attemptKey(ip, email);
  const entry = attempts.get(key);
  if (!entry || entry.failures < maxFailures()) {
    return { limited: false, retryAfterSeconds: 0 };
  }
  const elapsed = Date.now() - entry.windowStartedAt;
  const remainingMs = Math.max(0, windowMs() - elapsed);
  return {
    limited: true,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
  };
}

/** Test-only: reset in-memory counters. */
export function _resetLoginRateLimitForTests(): void {
  attempts.clear();
}
