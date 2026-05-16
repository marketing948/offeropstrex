// Small fetch helper for the new CampaignOps endpoints that aren't
// covered by the orval-generated client (the redesign skipped
// regenerating the API spec). Mirrors the auth header convention used
// elsewhere in the app (`localStorage["authToken"]` → Bearer).

export function readAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  // Primary: token lives inside the `offerops_session` JSON written by AuthProvider.
  try {
    const raw = window.localStorage.getItem("offerops_session");
    if (raw) {
      const parsed = JSON.parse(raw) as { token?: unknown };
      if (typeof parsed.token === "string" && parsed.token) return parsed.token;
    }
  } catch {
    /* fall through to legacy key */
  }
  // Legacy fallback for any code path that may still write `authToken` directly.
  return window.localStorage.getItem("authToken");
}

export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = readAuthToken();
  const headers = new Headers(init.headers ?? {});
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(input, { ...init, headers });
  return res;
}

export async function authedJson<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(input, init);
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try { detail = (JSON.parse(text) as { error?: string }).error ?? text; } catch { /* ignore */ }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}
