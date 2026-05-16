// Pivot Phase 0 — frontend Voluum kill-switch.
//
// The product pivot moved OfferOps to a manual-first Campaign Operations
// flow. The backend gates every Voluum HTTP path behind ENABLE_VOLUUM
// (default off). The frontend mirrors the same flag at build time via
// Vite's `VITE_ENABLE_VOLUUM` env var, so a single env change re-enables
// the integration top-to-bottom with no code edit:
//
//   ENABLE_VOLUUM=true VITE_ENABLE_VOLUUM=true pnpm dev
//
// When the flag is off:
//   - users never see fields the server cannot satisfy,
//   - existing free-text Affiliate Network / Traffic Source inputs are
//     used directly (manual mode),
//   - the Tracker Campaigns page renders a "disabled" notice,
//   - every Voluum-namespaced React Query hook is disabled so the
//     network tab shows zero `/api/sync/voluum/*` calls.
//
// Phase 5 will quarantine Voluum frontend code into its own module and
// remove this flag in favor of an isolated mount point.
function readFlag(): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>)["VITE_ENABLE_VOLUUM"];
  if (!raw) return false;
  const norm = String(raw).trim().toLowerCase();
  return norm === "true" || norm === "1" || norm === "yes" || norm === "on";
}

export const VOLUUM_UI_ENABLED: boolean = readFlag();
