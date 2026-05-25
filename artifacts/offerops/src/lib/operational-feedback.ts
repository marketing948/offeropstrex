/** User-facing copy for operational surfaces — avoid raw API/errors in UI. */

export function operationalErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (!msg) return fallback;
    if (/failed to fetch|network|load failed/i.test(msg)) {
      return fallback;
    }
    if (/401|403|unauthorized|forbidden/i.test(msg)) {
      return "You may not have access to this data. Try signing in again or contact an admin.";
    }
    if (/404|not found/i.test(msg)) {
      return fallback;
    }
    if (/500|internal|server error/i.test(msg)) {
      return fallback;
    }
    if (msg.length > 120) return fallback;
    return msg;
  }
  return fallback;
}
