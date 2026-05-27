import cors from "cors";

const DEV_DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

/** Comma-separated origins from CORS_ORIGIN, or dev defaults / empty (fail closed) in production. */
export function getAllowedCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }
  if (process.env.NODE_ENV === "production") {
    return [];
  }
  return [...DEV_DEFAULT_ORIGINS];
}

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  return getAllowedCorsOrigins().includes(origin);
}

export function createCorsMiddleware() {
  return cors({
    origin(origin, callback) {
      if (!origin || isCorsOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });
}
