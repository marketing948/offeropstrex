import crypto from "node:crypto";

// Minimal HS256 JWT signer for the workspace-isolation HTTP tests.
// Must stay claim-compatible with the API's verifier in
// artifacts/api-server/src/lib/auth-tokens.ts (issuer/audience/sub/exp, HS256).
// Local duplicate avoids importing API source across TS package boundaries
// (rootDir violation: TS5097/TS6059).

const TOKEN_ISSUER = "offerops";
const TOKEN_AUDIENCE = "offerops-api";
const DEFAULT_EXPIRY_SECONDS = 8 * 60 * 60;

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

export function signTestAuthToken(
  employeeId: number,
  secret: string,
  expiresInSeconds: number = DEFAULT_EXPIRY_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: String(employeeId),
      iat: now,
      exp: now + expiresInSeconds,
      iss: TOKEN_ISSUER,
      aud: TOKEN_AUDIENCE,
    }),
  );
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}
