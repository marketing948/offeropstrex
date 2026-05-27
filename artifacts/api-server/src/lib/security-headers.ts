import helmet from "helmet";

/** Security headers for JSON API responses (CSP disabled — no HTML). */
export function createSecurityHeadersMiddleware() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
}
