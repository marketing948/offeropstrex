import jwt from "jsonwebtoken";

const TOKEN_ISSUER = "offerops";
const TOKEN_AUDIENCE = "offerops-api";
const DEFAULT_EXPIRY = "8h";

const DEV_FALLBACK_SECRET = "offerops-dev-auth-secret-do-not-use-in-production";

function resolveAuthTokenSecret(): string {
  const configured = process.env.AUTH_TOKEN_SECRET?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_TOKEN_SECRET is required in production");
  }

  return DEV_FALLBACK_SECRET;
}

/** True when the token matches the legacy forgeable base64 format (rejected). */
export function isLegacyBase64AuthToken(token: string): boolean {
  if (!token || token.includes(".")) return false;
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length < 2) return false;
    const id = Number(parts[0]);
    return Number.isInteger(id) && id > 0;
  } catch {
    return false;
  }
}

export function signAuthToken(
  employeeId: number,
  options?: { expiresIn?: string | number },
): string {
  const expiresIn = options?.expiresIn ?? DEFAULT_EXPIRY;
  return jwt.sign(
    { sub: String(employeeId) },
    resolveAuthTokenSecret(),
    {
      expiresIn: typeof expiresIn === "number" ? expiresIn : (expiresIn as jwt.SignOptions["expiresIn"]),
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    },
  );
}

/** Returns employee id from a verified JWT, or null if invalid/expired/legacy. */
export function verifyAuthToken(token: string): number | null {
  if (!token?.trim()) return null;
  if (isLegacyBase64AuthToken(token)) return null;

  const segments = token.split(".");
  if (segments.length !== 3) return null;

  try {
    const payload = jwt.verify(token, resolveAuthTokenSecret(), {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    }) as jwt.JwtPayload;

    const raw = payload.sub ?? payload.employeeId;
    const employeeId = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(employeeId) || employeeId <= 0) return null;
    return employeeId;
  } catch {
    return null;
  }
}
