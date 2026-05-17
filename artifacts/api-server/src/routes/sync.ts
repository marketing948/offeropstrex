// Phase 5 (Task #14) — sync route. After Phase 5a-5e, all engine-owned
// mutations (testing_batches, todo_tasks, notifications, tracker_campaigns)
// flow through `engine/event-bus.ts::emit()` / `executeCreateBatch()` so
// the AST lint at `scripts/src/check-no-direct-domain-mutations.ts` is
// satisfied without a file-level allowlist entry. Direct mutations on
// non-engine tables (voluum_*, performance, workspaces, settings) remain.
import { Router, type IRouter } from "express";
import { eq, and, inArray, sql, isNull, isNotNull } from "drizzle-orm";
import {
  db, performanceTable, testingBatchesTable,
  notificationsTable, todoTasksTable, offersTable,
  workspacesTable, voluumTrafficSourcesTable, voluumAffiliateNetworksTable,
  voluumCampaignMappingsTable, voluumCampaignsTable, voluumOffersTable,
  employeesTable, employeeWorkspaceAssignmentsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { getEmployeeFromToken } from "./auth";
import { checkWorkspaceAccess as sharedCheckWorkspaceAccess, requireWorkspaceFromQuery, requireWorkspaceAccess, requireAdmin } from "../lib/workspace-access";
import { requireWorkspaceFromBody } from "../lib/require-workspace";
import { serializeWorkspaceForEmployee, setActiveWorkspaceForEmployee } from "../lib/active-workspace";
import { upsertSetting } from "../lib/settings-store";
import { normalizeRawTags, pickValidVoluumTag, validateTrackerCampaignTag, type VoluumTagSkipReason, type TrackerCampaignTagSkipReason } from "../lib/voluum-tag";
import { isVoluumDryRunEnabled } from "../lib/feature-flags";
// SPEC Phase 1: parseVoluumCampaignName is being phased out as a workflow
// driver. The structured-name auto-mapping pre-pass it powered has been
// removed. The remaining call site (device detection in the mapping loop
// below) carries an explicit TODO(Phase 2) and will be replaced with
// tag-driven device extraction when Phase 2 lands.
import { parseVoluumCampaignName } from "../lib/voluum-campaign-name";
import { emit } from "../engine/event-bus.ts";
import { checkClickThresholds } from "./sync/click-threshold.ts";

const router: IRouter = Router();

const VOLUUM_AUTH_URL = "https://api.voluum.com/auth/access/session";
const DEFAULT_VOLUUM_BASE_URL = "https://api.voluum.com";

// Best-effort device inference from a Voluum campaign name. Returns one of
// FIXED_DEVICES (`iOS 3G`, `iOS Wifi`, `Android 3G`, `Android Wifi`,
// `Desktop`) or null when the device cannot be determined. Tokenization is
// case-insensitive and tolerates `_`, `-`, or whitespace separators.
function inferDeviceFromCampaignName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  const hasIOS = /\bios\b/.test(n) || /\biphone\b/.test(n);
  const hasAndroid = /\bandroid\b/.test(n);
  const hasDesktop = /\bdesktop\b/.test(n) || /\bweb\b/.test(n) || /\bpc\b/.test(n);
  const has3G = /\b3g\b/.test(n) || /\bmobile[\s_-]*data\b/.test(n) || /\bcarrier\b/.test(n);
  const hasWifi = /\bwifi\b/.test(n) || /\bwi[\s_-]*fi\b/.test(n);
  if (hasDesktop && !hasIOS && !hasAndroid) return "Desktop";
  if (hasIOS && has3G) return "iOS 3G";
  if (hasIOS && hasWifi) return "iOS Wifi";
  if (hasAndroid && has3G) return "Android 3G";
  if (hasAndroid && hasWifi) return "Android Wifi";
  return null;
}

// Voluum sometimes returns scalar string fields as objects, e.g. `country`
// arrives as `{ code: "DE", name: "Germany" }` instead of `"DE"`. Pull the
// most useful string out so downstream code can treat it as plain text.
function normalizeCountryCode(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidate = obj.code ?? obj.countryCode ?? obj.country_code ?? obj.id ?? obj.name;
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

// Same defensive coercion for name-shaped fields (affiliate network name,
// traffic source name) that Voluum occasionally returns as `{ id, name }`.
function normalizeNameField(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidate = obj.name ?? obj.label ?? obj.title ?? obj.code ?? obj.id;
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

function sanitizeErrorBody(body: string, status: number): string {
  const trimmed = body.trim();
  if (trimmed.startsWith("<") || trimmed.toLowerCase().includes("<!doctype")) {
    return `HTTP ${status} — non-JSON response received from Voluum (possible endpoint or auth issue)`;
  }
  return trimmed.length > 500 ? trimmed.slice(0, 500) + "…" : trimmed;
}

async function getVoluumToken(accessId: string, accessKey: string): Promise<string> {
  logger.info({ url: VOLUUM_AUTH_URL, method: "POST" }, "Voluum auth request");

  const res = await fetch(VOLUUM_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Accept": "application/json",
    },
    body: JSON.stringify({ accessId, accessKey }),
  });

  logger.info({ url: VOLUUM_AUTH_URL, status: res.status }, "Voluum auth response");

  if (!res.ok) {
    const rawBody = await res.text();
    const cleanBody = sanitizeErrorBody(rawBody, res.status);
    logger.warn({ url: VOLUUM_AUTH_URL, status: res.status, body: cleanBody }, "Voluum auth failed");
    throw new Error(`Voluum connection failed. Please check the API endpoint and credentials. (${res.status})`);
  }

  const data = await res.json() as { token?: string };
  if (!data.token) throw new Error("Voluum auth succeeded but no token was returned");
  return data.token;
}

type VoluumCredentialValidation =
  | { valid: true }
  | { valid: false; code: "VOLUUM_AUTH_FAILED" };

async function validateVoluumCredentialsOnly(accessId: string, accessKey: string): Promise<VoluumCredentialValidation> {
  try {
    logger.info({ url: VOLUUM_AUTH_URL, method: "POST" }, "Voluum dry-run auth validation request");

    const res = await fetch(VOLUUM_AUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json",
      },
      body: JSON.stringify({ accessId, accessKey }),
    });

    logger.info({ url: VOLUUM_AUTH_URL, status: res.status }, "Voluum dry-run auth validation response");

    if (!res.ok) {
      return { valid: false, code: "VOLUUM_AUTH_FAILED" };
    }

    const data = await res.json().catch(() => null) as { token?: unknown } | null;
    if (typeof data?.token !== "string" || data.token.trim().length === 0) {
      return { valid: false, code: "VOLUUM_AUTH_FAILED" };
    }

    return { valid: true };
  } catch {
    logger.warn({ url: VOLUUM_AUTH_URL }, "Voluum dry-run auth validation failed");
    return { valid: false, code: "VOLUUM_AUTH_FAILED" };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SyncLog = any;

/**
 * Filter RAW Voluum response items (before any mapping/normalization) by
 * workspace ownership. Voluum may include workspaceId/workspace_id/workspace.id
 * or workspaceName/workspace_name/workspace.name on records. If those fields
 * are present we reject mismatches; if absent, scoping is enforced solely by
 * the request URL/params (which we log on every helper call).
 *
 * Used inside each fetch helper so workspace markers don't get stripped by
 * mapping before validation can see them.
 */
function filterRawByWorkspace<T extends Record<string, any>>(
  items: T[],
  voluumWorkspaceId: string | null,
  log: SyncLog,
  kind: string,
): T[] {
  if (!voluumWorkspaceId) return items;
  const kept: T[] = [];
  let rejected = 0;
  for (const item of items) {
    const itemWsId = item?.workspaceId ?? item?.workspace_id ?? item?.workspace?.id ?? null;
    const ok = itemWsId == null ? true : String(itemWsId) === voluumWorkspaceId;
    if (ok) {
      kept.push(item);
    } else {
      rejected++;
      log.warn({ kind, expected: voluumWorkspaceId, got: itemWsId }, "[Voluum] raw item rejected — workspace mismatch");
    }
  }
  if (rejected > 0) log.warn({ kind, rejected, kept: kept.length }, "[Voluum] cross-workspace raw items filtered");
  return kept;
}

/**
 * Post-mapping validation kept as a defence-in-depth check for cases where
 * mapping preserves a workspace field. Most helpers strip these fields, so the
 * authoritative gate is `filterRawByWorkspace` inside each helper.
 */
function validateWorkspaceItems<T extends Record<string, any>>(
  items: T[],
  voluumWorkspaceId: string,
  voluumWorkspaceName: string | null,
  log: SyncLog,
  kind: string,
): { kept: T[]; rejected: number } {
  let rejected = 0;
  const kept: T[] = [];
  for (const item of items) {
    const itemWsId =
      item?.workspaceId ??
      item?.workspace_id ??
      item?.workspace?.id ??
      null;
    const itemWsName =
      item?.workspaceName ??
      item?.workspace_name ??
      item?.workspace?.name ??
      null;

    const idMatches = itemWsId == null ? true : String(itemWsId) === voluumWorkspaceId;
    const nameMatches =
      itemWsName == null || voluumWorkspaceName == null
        ? true
        : String(itemWsName) === voluumWorkspaceName;

    if (idMatches && nameMatches) {
      kept.push(item);
    } else {
      rejected++;
      log.warn(
        { kind, expectedId: voluumWorkspaceId, expectedName: voluumWorkspaceName, gotId: itemWsId, gotName: itemWsName },
        "[Voluum] item rejected — workspace mismatch",
      );
    }
  }
  if (rejected > 0) {
    log.warn({ kind, rejected, kept: kept.length }, "[Voluum] cross-workspace items filtered");
  }
  return { kept, rejected };
}

// checkWorkspaceAccess moved to ../lib/workspace-access.ts (shared with all route files)
const checkWorkspaceAccess = sharedCheckWorkspaceAccess;

async function fetchVoluumCampaignsEnhanced(
  token: string,
  apiBaseUrl: string,
  options: { voluumWorkspaceId?: string | null; log: SyncLog },
): Promise<Array<{
  campaignId: string;
  campaignName: string;
  trafficSourceName: string | null;
  trafficSourceId: string | null;
  affiliateNetworkName: string | null;
  affiliateNetworkId: string | null;
  country: string | null;
  status: string | null;
  allTags: string[];
}>> {
  const { log } = options;
  const voluumWorkspaceId = options.voluumWorkspaceId?.trim() || null;
  const params = new URLSearchParams();
  if (voluumWorkspaceId) params.set("workspaceId", voluumWorkspaceId);
  const qs = params.size ? "?" + params.toString() : "";
  const url = `${apiBaseUrl}/campaign${qs}`;

  log.info({ url, method: "GET", voluumWorkspaceId }, "[Voluum] campaigns enhanced request");

  let res: Response;
  try {
    res = await fetch(url, { headers: { "cwauth-token": token, "Accept": "application/json" } });
  } catch (netErr: any) {
    log.error({ url, err: netErr?.message }, "[Voluum] campaigns network error (non-fatal)");
    return [];
  }

  log.info({ url, status: res.status }, "[Voluum] campaigns enhanced response");

  if (!res.ok) {
    const rawBody = await res.text();
    log.warn({ url, status: res.status, body: sanitizeErrorBody(rawBody, res.status) }, "[Voluum] campaigns fetch failed (non-fatal)");
    return [];
  }

  const rawBody = await res.text();
  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch {
    log.error({ url }, "[Voluum] campaigns JSON parse error (non-fatal)");
    return [];
  }

  const rawItems = data.payload ?? data.campaigns ?? data.rows ?? data.elements ?? (Array.isArray(data) ? data : []);
  const items = filterRawByWorkspace(rawItems, voluumWorkspaceId, log, "campaign");
  log.info({ count: items.length, raw: rawItems.length }, "[Voluum] campaigns enhanced parsed");
  if (items.length > 0) log.info({ sample: JSON.stringify(items[0]).slice(0, 400) }, "[Voluum] campaign sample item");

  return items.map((c: any) => ({
    campaignId: String(c.id ?? c.campaignId ?? ""),
    campaignName: String(c.name ?? c.campaignName ?? ""),
    trafficSourceName: normalizeNameField(c.trafficSourceName ?? c.traffic_source_name ?? c.trafficSource),
    trafficSourceId: c.trafficSourceId ?? c.traffic_source_id ?? null,
    affiliateNetworkName: normalizeNameField(c.affiliateNetworkName ?? c.affiliate_network_name ?? c.affiliateNetwork),
    affiliateNetworkId: c.affiliateNetworkId ?? c.affiliate_network_id ?? null,
    country: normalizeCountryCode(c.country ?? c.geo ?? c.country_code),
    status: c.status ?? null,
    allTags: normalizeRawTags(c.tags ?? c.tag),
  })).filter((c: any) => c.campaignId && c.campaignName);
}

async function fetchVoluumOffers(
  token: string,
  apiBaseUrl: string,
  options: { voluumWorkspaceId?: string | null; log: SyncLog },
): Promise<Array<{
  offerId: string;
  offerName: string;
  affiliateNetworkName: string | null;
  affiliateNetworkId: string | null;
  country: string | null;
  offerUrl: string | null;
  primaryTag: string | null;
  allTags: string[];
  status: string | null;
}>> {
  const { log } = options;
  const voluumWorkspaceId = options.voluumWorkspaceId?.trim() || null;
  const params = new URLSearchParams();
  if (voluumWorkspaceId) params.set("workspaceId", voluumWorkspaceId);
  const qs = params.size ? "?" + params.toString() : "";
  const url = `${apiBaseUrl}/offer${qs}`;

  log.info({ url, method: "GET", voluumWorkspaceId }, "[Voluum] offers request");

  let res: Response;
  try {
    res = await fetch(url, { headers: { "cwauth-token": token, "Accept": "application/json" } });
  } catch (netErr: any) {
    log.error({ url, err: netErr?.message }, "[Voluum] offers network error (non-fatal)");
    return [];
  }

  log.info({ url, status: res.status }, "[Voluum] offers response");

  if (!res.ok) {
    const rawBody = await res.text();
    log.warn({ url, status: res.status, body: sanitizeErrorBody(rawBody, res.status) }, "[Voluum] offers fetch failed (non-fatal)");
    return [];
  }

  const rawBody = await res.text();
  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch {
    log.error({ url }, "[Voluum] offers JSON parse error (non-fatal)");
    return [];
  }

  const rawItems = data.payload ?? data.offers ?? data.rows ?? data.elements ?? (Array.isArray(data) ? data : []);
  const items = filterRawByWorkspace(rawItems, voluumWorkspaceId, log, "offer");
  log.info({ count: items.length, raw: rawItems.length }, "[Voluum] offers parsed");
  if (items.length > 0) log.info({ sample: JSON.stringify(items[0]).slice(0, 400) }, "[Voluum] offer sample item");

  return items.map((o: any) => {
    const tags = normalizeRawTags(o.tags ?? o.tag);
    return {
      offerId: String(o.id ?? o.offerId ?? ""),
      offerName: String(o.name ?? o.offerName ?? ""),
      affiliateNetworkName: normalizeNameField(o.affiliateNetworkName ?? o.affiliate_network_name ?? o.affiliateNetwork),
      affiliateNetworkId: o.affiliateNetworkId ?? o.affiliate_network_id ?? null,
      country: normalizeCountryCode(o.country ?? o.geo ?? o.country_code),
      offerUrl: o.url ?? o.offerUrl ?? null,
      // primaryTag is provisional here — sync code re-derives it from the
      // matched valid tag via pickValidVoluumTag before insert.
      primaryTag: tags[0] ?? null,
      allTags: tags,
      status: o.status ?? null,
    };
  }).filter((o: any) => o.offerId && o.offerName);
}

export async function autoGroupOffersIntoBatches(
  workspaceId: number,
  log: SyncLog,
): Promise<{ batchesCreated: number; offersGrouped: number; tasksCreated: number; batchesDetectedInCampaign: number; tasksAutoCompleted: number }> {
  const nowTs = new Date();

  // Fetch all active, untagged+tagged offers in this workspace from DB.
  // `isActive=true` already excludes tombstoned (deletedAt set) rows.
  const allOffers = await db.select().from(voluumOffersTable).where(
    and(eq(voluumOffersTable.workspaceId, workspaceId), eq(voluumOffersTable.isActive, true))
  );

  // The OfferOps tag itself is the authoritative source for
  // (affiliateInitials, geo, batchNumber). We deliberately do NOT require
  // affiliateNetworkName/country to be populated on the offer row — Voluum's
  // /offer endpoint frequently omits affiliate_network_name (empty string) and
  // historically returned country as an object rather than a string. Falling
  // back to the parsed tag guarantees that any offer with a valid tag gets
  // grouped into a batch.
  type GroupableOffer = (typeof allOffers)[number] & {
    parsedAffiliate: string;
    parsedGeo: string;
    parsedTag: string;
  };
  const groupable: GroupableOffer[] = [];
  for (const o of allOffers) {
    if (!o.primaryTag) continue;
    const parsed = pickValidVoluumTag([o.primaryTag]);
    if (!parsed.valid) continue;
    groupable.push({
      ...o,
      parsedAffiliate: parsed.parsed.affiliateInitials,
      parsedGeo: parsed.parsed.geo,
      parsedTag: parsed.parsed.tag,
    });
  }

  // Group by canonical tag — that already uniquely identifies the batch.
  const groups = new Map<string, GroupableOffer[]>();
  for (const offer of groupable) {
    const key = offer.parsedTag;
    const existing = groups.get(key) ?? [];
    existing.push(offer);
    groups.set(key, existing);
  }

  // Get default employee (first admin)
  const [defaultEmployee] = await db.select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.role, "admin"))
    .limit(1);
  const employeeId = defaultEmployee?.id ?? 1;

  // Phase 2 patch: the legacy traffic-source × device plan table was
  // dropped. Auto-fan-out of `create_test_campaign` tasks is now Phase 3
  // engine work — it will create one CREATE_IOS_TRACKER_CAMPAIGN + one
  // CREATE_ANDROID_TRACKER_CAMPAIGN task per new batch using the
  // workspace_traffic_sources order. Until then, no fan-out happens here.
  const planRows: ReadonlyArray<{ trafficSourceName: string; device: string }> = [];

  // Phase 11 (consolidation): batch creation is now exclusively owned
  // by the OfferImported engine handler. This loop emits one
  // OfferImported event per groupable offer (deduped on
  // `voluum_offer:<id>`) and lets the handler do everything:
  //   - upsert testing_batches (workspaceId, batchTag)
  //   - link voluum_offers.batchId
  //   - chain-emit BatchCreated on first creation (which seeds tracker
  //     tasks + notification via the Phase-4 cascade)
  //   - emit RecomputeBatchOfferCount to keep numberOfOffers in sync
  //
  // The previous tag-grouped tx that called executeCreateBatch +
  // emitWithinTx(BatchCreated) directly was a duplicate ownership path
  // — rejected as a remaining risk. Counts are derived from before/
  // after diffs of the workspace's batches/linked-offers so the route's
  // response shape stays compatible with sync-autogroup tests.
  void groups; // groups Map kept above for the per-tag log breakdown only.
  void employeeId; // owner is resolved inside the handler now.
  void planRows;

  // Counts are computed against THIS run's candidate set only (not the
  // workspace-wide totals) so concurrent sync runs touching unrelated
  // tags/offers cannot inflate or distort the response numbers.
  const candidateOfferIds = groupable.map(o => o.id);
  const candidateTags = Array.from(new Set(groupable.map(o => o.parsedTag)));

  const tagsBefore = new Set<string>(
    candidateTags.length === 0
      ? []
      : (await db
          .select({ batchTag: testingBatchesTable.batchTag })
          .from(testingBatchesTable)
          .where(and(
            eq(testingBatchesTable.workspaceId, workspaceId),
            inArray(testingBatchesTable.batchTag, candidateTags),
          ))
        ).map(r => r.batchTag).filter((t): t is string => t != null),
  );
  const linkedBefore = new Set<number>(
    candidateOfferIds.length === 0
      ? []
      : (await db
          .select({ id: voluumOffersTable.id })
          .from(voluumOffersTable)
          .where(and(
            eq(voluumOffersTable.workspaceId, workspaceId),
            inArray(voluumOffersTable.id, candidateOfferIds),
            isNotNull(voluumOffersTable.batchId),
          ))
        ).map(r => r.id),
  );

  for (const offer of groupable) {
    try {
      await emit({
        type: "OfferImported",
        workspaceId,
        payload: {
          voluumOfferId: offer.offerId,
          offerId: offer.id,
          tag: offer.parsedTag,
          affiliateNetworkName: offer.parsedAffiliate,
          geo: offer.parsedGeo,
        },
        dedupeKey: `voluum_offer:${offer.offerId}`,
      });
    } catch (emitErr: any) {
      log.warn(
        { err: emitErr?.message, voluumOfferId: offer.offerId, tag: offer.parsedTag },
        "[AutoGroup] OfferImported emit failed — continuing",
      );
    }
  }

  const tagsAfter = new Set<string>(
    candidateTags.length === 0
      ? []
      : (await db
          .select({ batchTag: testingBatchesTable.batchTag })
          .from(testingBatchesTable)
          .where(and(
            eq(testingBatchesTable.workspaceId, workspaceId),
            inArray(testingBatchesTable.batchTag, candidateTags),
          ))
        ).map(r => r.batchTag).filter((t): t is string => t != null),
  );
  const linkedAfter = new Set<number>(
    candidateOfferIds.length === 0
      ? []
      : (await db
          .select({ id: voluumOffersTable.id })
          .from(voluumOffersTable)
          .where(and(
            eq(voluumOffersTable.workspaceId, workspaceId),
            inArray(voluumOffersTable.id, candidateOfferIds),
            isNotNull(voluumOffersTable.batchId),
          ))
        ).map(r => r.id),
  );
  const batchesCreated = candidateTags.filter(t => !tagsBefore.has(t) && tagsAfter.has(t)).length;
  const offersGrouped = candidateOfferIds.filter(id => !linkedBefore.has(id) && linkedAfter.has(id)).length;
  const tasksCreated = 0; // tasks are seeded by the engine cascade now.

  // After grouping, detect which batches are now inside a Voluum campaign
  // and auto-complete their "first-test" tasks.
  const detection = await detectBatchesInVoluumCampaigns(workspaceId, nowTs, log);

  log.info({
    batchesCreated, offersGrouped, totalGroups: groups.size,
    tasksCreated,
    batchesDetectedInCampaign: detection.batchesDetectedInCampaign,
    tasksAutoCompleted: detection.tasksAutoCompleted,
  }, "[AutoGroup] Offer grouping complete");

  return { batchesCreated, offersGrouped, tasksCreated, ...detection };
}

/**
 * For each non-soft-deleted voluum_campaign_mapping in the workspace,
 * stamp the linked batch with the Voluum campaign id/name, transition it
 * to `live_testing` if still in a pre-live status, and auto-complete any
 * open `create_test_campaign` tasks (matched by traffic source and, when
 * inferable, device) plus any legacy `add_to_live_campaign` task.
 *
 * The mappings table is the source of truth for "this batch is inside a
 * Voluum campaign". Mappings can be created manually by users (POST
 * /sync/voluum/mappings) or by future automation; either way, this pass
 * keeps the batch + task state consistent.
 */
async function detectBatchesInVoluumCampaigns(
  workspaceId: number,
  nowTs: Date,
  log: SyncLog,
): Promise<{ batchesDetectedInCampaign: number; tasksAutoCompleted: number }> {
  // ── Phase 6b: invalid tracker-tag detection pass ────────────────────
  // Independently of the mapping/import flow below, scan every active
  // voluum_campaign in this workspace whose tags STRUCTURALLY look like
  // tracker-campaign tags (4 underscore-parts with a `batch<n>` middle
  // segment). If none of the campaign's
  // tracker-shaped tags is valid, emit a VoluumCampaignTagInvalid event
  // so the engine can fan out an INVALID_TAG notification to admins.
  //
  // Gating on the structural shape avoids spamming on every offer-tagged
  // campaign (offer tags follow `<initials>_<geo>_<prefix><n>` — 3 parts).
  // Idempotency: dedupeKey `invalid_tag:<voluumCampaignId>:<reason>` so
  // a campaign whose diagnosis is stable across syncs only generates one
  // notification cohort; a fix that changes the reason (e.g. operator
  // adjusts the tag and now it fails for a different reason) DOES
  // re-notify, which is the correct behaviour.
  try {
    // SPEC §4: tracker tag no longer carries a traffic-source segment,
    // so workspace traffic-source membership is no longer used here.
    const allCampaigns = await db.select({
      campaignId: voluumCampaignsTable.campaignId,
      campaignName: voluumCampaignsTable.campaignName,
      allTags: voluumCampaignsTable.allTags,
    })
      .from(voluumCampaignsTable)
      .where(and(
        eq(voluumCampaignsTable.workspaceId, workspaceId),
        eq(voluumCampaignsTable.isActive, true),
        isNull(voluumCampaignsTable.deletedAt),
      ));

    // SPEC §4: tracker tags have exactly 4 underscore-separated segments
    // with a `batch<n>` token in the middle (`<aff>_<geo>_batch<n>_<platform>`).
    // Anything else is presumed to be an offer tag (or noise) and skipped —
    // we don't want to tell admins their offer tags are invalid tracker tags.
    const looksLikeTrackerTag = (t: string): boolean => {
      const parts = t.split("_");
      return parts.length === 4 && /^batch[0-9]+$/i.test(parts[2] ?? "");
    };

    let invalidEmits = 0;
    for (const camp of allCampaigns) {
      let tags: string[] = [];
      try {
        tags = normalizeRawTags(camp.allTags ? JSON.parse(camp.allTags) : []);
      } catch {
        // Stored as a comma-separated string — let normalizeRawTags handle it.
        tags = normalizeRawTags(camp.allTags);
      }
      const trackerShaped = tags.filter(looksLikeTrackerTag);
      if (trackerShaped.length === 0) continue;

      // If ANY tracker-shaped tag validates, the campaign is fine — the
      // import flow downstream will pick it up.
      let firstReason: TrackerCampaignTagSkipReason | null = null;
      let firstOffender: string | null = null;
      let anyValid = false;
      for (const t of trackerShaped) {
        const r = validateTrackerCampaignTag(t);
        if (r.valid) { anyValid = true; break; }
        if (firstReason === null) {
          firstReason = r.reason;
          firstOffender = r.offendingTag;
        }
      }
      if (anyValid || firstReason === null) continue;

      try {
        await emit({
          type: "VoluumCampaignTagInvalid",
          workspaceId,
          payload: {
            voluumCampaignId: camp.campaignId,
            voluumCampaignName: camp.campaignName,
            offendingTag: firstOffender,
            reason: firstReason,
          },
          dedupeKey: `invalid_tag:${camp.campaignId}:${firstReason}`,
        });
        invalidEmits++;
      } catch (err) {
        log.warn(
          { err, voluumCampaignId: camp.campaignId },
          "[Detect] VoluumCampaignTagInvalid emit failed — continuing",
        );
      }
    }
    if (invalidEmits > 0) {
      log.info(
        { invalidEmits, workspaceId },
        "[Detect] emitted VoluumCampaignTagInvalid events for tracker-shaped tags",
      );
    }
  } catch (err) {
    log.warn(
      { err, workspaceId },
      "[Detect] invalid-tag detection pass failed — sync continues",
    );
  }

  // ── Spec-correction (post Phase 10): tag-based tracker detection ────
  // The auto-mapping path below relies on campaign-NAME parsing, which
  // can drift from how operators actually tag campaigns. Per spec
  // §6.3, tracker campaigns are identified by their TAG matching the
  // canonical pattern `<aff>_<geo>_batch<n>_<platform>`. For
  // every active voluum_campaign in this workspace whose tags include
  // a valid tracker tag whose (affiliate, geo, batchN) matches a
  // batch_tag in the workspace, emit TrackerCampaignImported directly.
  // Idempotency: dedupeKey `tracker_tag:<voluumCampaignId>:<device>`
  // ensures one event per (campaign, device) over the campaign's
  // lifetime — re-syncs are no-ops via the events partial unique index.
  try {
    const wsSourceRows = await db
      .select({
        id: voluumTrafficSourcesTable.id,
        name: voluumTrafficSourcesTable.name,
      })
      .from(voluumTrafficSourcesTable)
      .where(
        and(
          eq(voluumTrafficSourcesTable.workspaceId, workspaceId),
          eq(voluumTrafficSourcesTable.isActive, true),
        ),
      );
    const sourceIdByLowerName = new Map<string, number>(
      wsSourceRows.map((s) => [s.name.toLowerCase(), s.id]),
    );

    const wsBatchRows = await db
      .select({
        id: testingBatchesTable.id,
        batchTag: testingBatchesTable.batchTag,
      })
      .from(testingBatchesTable)
      .where(
        and(
          eq(testingBatchesTable.workspaceId, workspaceId),
          isNotNull(testingBatchesTable.batchTag),
        ),
      );
    // Index batches by exact lowercase batch tag. Offer and campaign tags
    // must match byte-for-byte on their shared batch segment.
    const batchIdByCanonical = new Map<string, number>();
    for (const b of wsBatchRows) {
      if (!b.batchTag) continue;
      batchIdByCanonical.set(b.batchTag, b.id);
    }

    const allCampsForTag = await db
      .select({
        campaignId: voluumCampaignsTable.campaignId,
        allTags: voluumCampaignsTable.allTags,
        trafficSourceName: voluumCampaignsTable.trafficSourceName,
      })
      .from(voluumCampaignsTable)
      .where(
        and(
          eq(voluumCampaignsTable.workspaceId, workspaceId),
          eq(voluumCampaignsTable.isActive, true),
          isNull(voluumCampaignsTable.deletedAt),
        ),
      );

    let tagBasedEmits = 0;
    for (const camp of allCampsForTag) {
      let tags: string[] = [];
      try {
        tags = normalizeRawTags(camp.allTags ? JSON.parse(camp.allTags) : []);
      } catch {
        tags = normalizeRawTags(camp.allTags);
      }
      // SPEC §4: TS comes from the Voluum campaign's own
      // trafficSourceName field, NOT parsed from the tag. Skip campaigns
      // with no TS configured in Voluum — they cannot be assigned to a
      // sequential traffic-source stage.
      const tsName = camp.trafficSourceName;
      if (!tsName) continue;
      const trafficSourceId = sourceIdByLowerName.get(tsName.toLowerCase());
      if (!trafficSourceId) continue;
      for (const t of tags) {
        const r = validateTrackerCampaignTag(t);
        if (!r.valid) continue;
        const batchId = batchIdByCanonical.get(r.parsed.batchTag);
        if (!batchId) continue;
        try {
          await emit({
            type: "TrackerCampaignImported",
            workspaceId,
            payload: {
              batchId,
              trafficSourceId,
              device: r.parsed.device,
              voluumCampaignId: camp.campaignId,
              tag: r.parsed.tag,
            },
            dedupeKey: `tracker_tag:${camp.campaignId}:${r.parsed.device}`,
          });
          tagBasedEmits++;
        } catch (err) {
          log.warn(
            { err, voluumCampaignId: camp.campaignId, tag: r.parsed.tag },
            "[Detect] tag-based TrackerCampaignImported emit failed — sync continues",
          );
        }
        // Only one valid tracker tag per campaign matters — the rest
        // are duplicates pointing at the same (batch, device, source).
        break;
      }
    }
    if (tagBasedEmits > 0) {
      log.info(
        { tagBasedEmits, workspaceId },
        "[Detect] tag-based TrackerCampaignImported pass complete",
      );
    }
  } catch (err) {
    log.warn(
      { err, workspaceId },
      "[Detect] tag-based tracker detection pass failed — sync continues",
    );
  }

  // ── Auto-mapping pre-pass ────────────────────────────────────────────
  // For every active voluum_campaign in this workspace whose primary_tag
  // matches a testing_batch.batch_tag (also workspace-scoped), insert a
  // voluum_campaign_mapping row if one doesn't already exist. The mapping
  // table's PK on campaignId + onConflictDoNothing keeps this idempotent.
  // Existing user-created mappings are not modified.
  const taggedCampaigns = await db.select({
    campaignId: voluumCampaignsTable.campaignId,
    campaignName: voluumCampaignsTable.campaignName,
    primaryTag: voluumCampaignsTable.primaryTag,
    trafficSourceName: voluumCampaignsTable.trafficSourceName,
  })
    .from(voluumCampaignsTable)
    .where(and(
      eq(voluumCampaignsTable.workspaceId, workspaceId),
      eq(voluumCampaignsTable.isActive, true),
      isNull(voluumCampaignsTable.deletedAt),
    ));

  const candidateCampaigns = taggedCampaigns.filter(c => c.primaryTag);
  if (candidateCampaigns.length > 0) {
    const tagsForLookup = candidateCampaigns.map(c => c.primaryTag!);
    const matchedBatches = await db.select({
      id: testingBatchesTable.id,
      batchTag: testingBatchesTable.batchTag,
      employeeId: testingBatchesTable.employeeId,
    })
      .from(testingBatchesTable)
      .where(and(
        eq(testingBatchesTable.workspaceId, workspaceId),
        isNotNull(testingBatchesTable.batchTag),
        inArray(testingBatchesTable.batchTag, tagsForLookup),
      ));
    const batchByTag = new Map<string, typeof matchedBatches[number]>();
    for (const b of matchedBatches) if (b.batchTag) batchByTag.set(b.batchTag, b);

    let autoMappingsCreated = 0;
    for (const camp of candidateCampaigns) {
      const matchedBatch = batchByTag.get(camp.primaryTag!);
      if (!matchedBatch) continue;

      const inserted = await db.insert(voluumCampaignMappingsTable).values({
        campaignId: camp.campaignId,
        campaignName: camp.campaignName,
        batchId: matchedBatch.id,
        workspaceId,
      }).onConflictDoUpdate({
        target: [voluumCampaignMappingsTable.workspaceId, voluumCampaignMappingsTable.campaignId],
        set: { batchId: matchedBatch.id, campaignName: camp.campaignName, deletedAt: null },
        setWhere: isNotNull(voluumCampaignMappingsTable.deletedAt),
      }).returning({ campaignId: voluumCampaignMappingsTable.campaignId });
      if (inserted.length > 0) {
        autoMappingsCreated++;
        log.info({ campaignId: camp.campaignId, campaignName: camp.campaignName, batchId: matchedBatch.id, tag: camp.primaryTag }, "[AutoMap] Linked Voluum campaign to batch by matching tag (revived if soft-deleted)");
      }
    }
    if (autoMappingsCreated > 0) {
      log.info({ autoMappingsCreated }, "[AutoMap] Auto-mapping pre-pass complete");
    }
  }

  // ── Structured campaign-name auto-mapping pre-pass — DISABLED (SPEC Phase 1)
  // Per the canonical spec (docs/SPEC.md), campaign-to-batch matching is
  // tag-driven only. The structured-name pre-pass that previously fell
  // back to parseVoluumCampaignName(camp.campaignName) is removed; the
  // tag-based AutoMap pre-pass above is now the single source of truth
  // for campaign↔batch linking.
  if (false as boolean) {
  {
    const existingMappingRows = await db.select({
      campaignId: voluumCampaignMappingsTable.campaignId,
    })
      .from(voluumCampaignMappingsTable)
      .where(and(
        eq(voluumCampaignMappingsTable.workspaceId, workspaceId),
        isNull(voluumCampaignMappingsTable.deletedAt),
      ));
    const alreadyMapped = new Set(existingMappingRows.map(r => r.campaignId));

    const unmappedCampaigns = taggedCampaigns.filter(c => !alreadyMapped.has(c.campaignId));

    if (unmappedCampaigns.length > 0) {
      // Pull every batch in this workspace and index by canonical
      // (affiliateInitials, geo). The (affiliate, geo) pair is taken from
      // whichever source we trust most: the parsed batch_tag when present
      // and valid, otherwise the batch row's own affiliate_network / geo
      // columns. Auto-group writes strict lowercase tags while preserving
      // parsed affiliate/geo display fields on the batch row,
      // so structured matching does not silently fail when a batch was
      // created without a tag or with a non-canonical / cleared tag.
      const wsBatches = await db.select({
        id: testingBatchesTable.id,
        batchTag: testingBatchesTable.batchTag,
        affiliateNetwork: testingBatchesTable.affiliateNetwork,
        geo: testingBatchesTable.geo,
      })
        .from(testingBatchesTable)
        .where(eq(testingBatchesTable.workspaceId, workspaceId));

      const batchesByAffGeo = new Map<string, Array<{ id: number; batchTag: string | null }>>();
      for (const b of wsBatches) {
        let affiliate: string | null = null;
        let geo: string | null = null;
        if (b.batchTag) {
          const parsed = pickValidVoluumTag([b.batchTag]);
          if (parsed.valid) {
            affiliate = parsed.parsed.affiliateInitials;
            geo = parsed.parsed.geo;
          }
        }
        if (!affiliate || !geo) {
          // Fall back to the batch row's own canonical fields. These are
          // already UPPER-CASE for tag-derived batches; uppercase defensively
          // to handle older rows / manual edits.
          if (b.affiliateNetwork && b.geo) {
            affiliate = b.affiliateNetwork.toUpperCase();
            geo = b.geo.toUpperCase();
          }
        }
        if (!affiliate || !geo) continue;
        const key = `${affiliate}::${geo}`;
        const arr = batchesByAffGeo.get(key) ?? [];
        arr.push({ id: b.id, batchTag: b.batchTag });
        batchesByAffGeo.set(key, arr);
      }

      let structuredMappingsCreated = 0;
      for (const camp of unmappedCampaigns) {
        const parsedName = parseVoluumCampaignName(camp.campaignName);
        if (!parsedName) {
          log.info(
            { campaignId: camp.campaignId, campaignName: camp.campaignName, decision: "unmatched_unparseable" },
            "[StructuredMatch] campaign name not in canonical shape — skipped",
          );
          continue;
        }
        const key = `${parsedName.affiliateInitials}::${parsedName.geo}`;
        const candidates = batchesByAffGeo.get(key) ?? [];
        if (candidates.length === 0) {
          log.info(
            {
              campaignId: camp.campaignId,
              campaignName: camp.campaignName,
              parsed: { affiliateInitials: parsedName.affiliateInitials, geo: parsedName.geo, device: parsedName.device, trafficSourceName: parsedName.trafficSourceName },
              decision: "unmatched_no_batch",
            },
            "[StructuredMatch] no batch in workspace matches parsed (affiliate, geo) — skipped",
          );
          continue;
        }
        if (candidates.length > 1) {
          // Per spec, structured-match decisions (including ambiguous
          // skips) are logged at INFO so they don't pollute the warn
          // stream — they're a normal expected outcome that a human
          // resolves manually.
          log.info(
            {
              campaignId: camp.campaignId,
              campaignName: camp.campaignName,
              parsed: { affiliateInitials: parsedName.affiliateInitials, geo: parsedName.geo },
              candidateBatchIds: candidates.map(c => c.id),
              decision: "ambiguous",
            },
            "[StructuredMatch] multiple batches match — skipped, leave for manual mapping",
          );
          continue;
        }
        const targetBatch = candidates[0];
        const inserted = await db.insert(voluumCampaignMappingsTable).values({
          campaignId: camp.campaignId,
          campaignName: camp.campaignName,
          batchId: targetBatch.id,
          workspaceId,
        }).onConflictDoUpdate({
          target: [voluumCampaignMappingsTable.workspaceId, voluumCampaignMappingsTable.campaignId],
          set: { batchId: targetBatch.id, campaignName: camp.campaignName, deletedAt: null },
          setWhere: isNotNull(voluumCampaignMappingsTable.deletedAt),
        }).returning({ campaignId: voluumCampaignMappingsTable.campaignId });
        if (inserted.length > 0) {
          structuredMappingsCreated++;
          log.info(
            {
              campaignId: camp.campaignId,
              campaignName: camp.campaignName,
              batchId: targetBatch.id,
              batchTag: targetBatch.batchTag,
              parsed: {
                affiliateInitials: parsedName.affiliateInitials,
                geo: parsedName.geo,
                device: parsedName.device,
                trafficSourceName: parsedName.trafficSourceName,
              },
              decision: "matched",
            },
            "[StructuredMatch] linked Voluum campaign to batch by canonical campaign name",
          );
        }
      }
      if (structuredMappingsCreated > 0) {
        log.info({ structuredMappingsCreated }, "[StructuredMatch] structured-name auto-mapping pre-pass complete");
      }
    }
  }
  } // end if (false) — SPEC Phase 1 disabled block

  const mappings = await db.select()
    .from(voluumCampaignMappingsTable)
    .where(and(
      eq(voluumCampaignMappingsTable.workspaceId, workspaceId),
      isNull(voluumCampaignMappingsTable.deletedAt),
    ));

  // A batch is considered "in a Voluum campaign" if any mapping points to
  // it. If multiple mappings exist for the same batch (rare), we pick the
  // most recent one for the denormalized campaignId/Name fields.
  const mappingsByBatch = new Map<number, typeof mappings[number]>();
  for (const m of mappings) {
    const prev = mappingsByBatch.get(m.batchId);
    if (!prev || m.createdAt > prev.createdAt) mappingsByBatch.set(m.batchId, m);
  }

  // Phase 5c (Task #15): the post-mapping engine-owned mutations
  // (testing_batches.status flip + voluumCampaignId/Name stamp +
  // todo_tasks SQL auto-completion) have been removed. Sync now only
  // EMITS one TrackerCampaignImported event per matched mapping; the
  // Phase 4 rule materialises the tracker_campaigns row, completes
  // the matching CREATE_*_TRACKER_CAMPAIGN task, and advances the
  // batch to OFFER_READY_FOR_LIVE_TESTING when both ios+android
  // arrive for the batch's CURRENT traffic source. Idempotency:
  // dedupeKey=`voluum_campaign:<voluumCampaignId>` so a second sync
  // for the same campaign is a no-op via the partial unique index
  // on events(workspace_id, type, dedupe_key).
  //
  // testing_batches.voluumCampaignId/Name are deprecated in Phase 2
  // (see lib/db/src/schema/testing-batches.ts); sync no longer writes
  // them. testing_batches.lastSyncAt is no longer engine-meaningful
  // and is also dropped to keep this loop free of direct mutations
  // on engine-owned tables (lint exemption stays for other parts of
  // sync.ts until 5g).
  let batchesDetectedInCampaign = 0;

  // Pre-load the workspace's voluum traffic sources so we can resolve
  // the parsed name → id without a per-mapping query.
  const wsTrafficSources = await db.select({
    id: voluumTrafficSourcesTable.id,
    name: voluumTrafficSourcesTable.name,
  })
    .from(voluumTrafficSourcesTable)
    .where(eq(voluumTrafficSourcesTable.workspaceId, workspaceId));
  const trafficSourceIdByLowerName = new Map<string, number>();
  for (const ts of wsTrafficSources) {
    trafficSourceIdByLowerName.set(ts.name.toLowerCase(), ts.id);
  }

  // Pre-load the matched batches so we can read batchTag (event payload).
  const batchIdsToLoad = Array.from(mappingsByBatch.keys());
  const batchRows = batchIdsToLoad.length === 0 ? [] : await db.select({
    id: testingBatchesTable.id,
    batchTag: testingBatchesTable.batchTag,
  })
    .from(testingBatchesTable)
    .where(and(
      inArray(testingBatchesTable.id, batchIdsToLoad),
      eq(testingBatchesTable.workspaceId, workspaceId),
    ));
  const batchById = new Map<number, { id: number; batchTag: string | null }>();
  for (const b of batchRows) batchById.set(b.id, b);

  // Compress legacy Voluum device labels down to the Phase-2
  // tracker_campaign_device enum. "Desktop" has no place in the
  // ios/android model — skip those mappings (the batch will surface
  // via UI but no tracker-task automation runs).
  const compressDevice = (label: string | null | undefined): "ios" | "android" | null => {
    if (!label) return null;
    const l = label.toLowerCase();
    if (l.startsWith("ios")) return "ios";
    if (l.startsWith("android")) return "android";
    return null;
  };

  for (const [batchId, mapping] of mappingsByBatch) {
    const batch = batchById.get(batchId);
    if (!batch) continue;

    // TODO(Phase 2): replace parseVoluumCampaignName-based device
    // detection with tag-driven extraction (look up the matching
    // voluum_campaigns row by mapping.campaignId, parse its primary
    // tracker tag suffix `_ios` / `_and`). Until Phase 2 lands,
    // this legacy parser is the only source of device for the engine
    // event emission below; without it the workflow stalls between
    // Phase 1 and Phase 2.
    const parsed = parseVoluumCampaignName(mapping.campaignName);
    const device = compressDevice(parsed?.device);
    if (!device) {
      log.info(
        { batchId, voluumCampaignId: mapping.campaignId, campaignName: mapping.campaignName, decision: "skip_no_device" },
        "[Detect] Voluum campaign has no ios/android device — no engine event emitted",
      );
      continue;
    }

    // Resolve trafficSourceId from the parsed name; fall back to the
    // stored voluum_campaigns.traffic_source_name when the parser
    // couldn't extract one. Comparison is case-insensitive.
    let trafficSourceName = parsed?.trafficSourceName ?? null;
    if (!trafficSourceName) {
      const [campMeta] = await db.select({
        trafficSourceName: voluumCampaignsTable.trafficSourceName,
      })
        .from(voluumCampaignsTable)
        .where(and(
          eq(voluumCampaignsTable.workspaceId, workspaceId),
          eq(voluumCampaignsTable.campaignId, mapping.campaignId),
        ))
        .limit(1);
      trafficSourceName = campMeta?.trafficSourceName ?? null;
    }
    const trafficSourceId = trafficSourceName
      ? trafficSourceIdByLowerName.get(trafficSourceName.toLowerCase()) ?? null
      : null;
    if (!trafficSourceId) {
      log.info(
        { batchId, voluumCampaignId: mapping.campaignId, campaignName: mapping.campaignName, trafficSourceName, decision: "skip_unknown_traffic_source" },
        "[Detect] Voluum campaign traffic source not found in workspace — no engine event emitted",
      );
      continue;
    }

    // Workspace-scoped tag: prefer the batch's stored batchTag
    // (UPPER-CASE canonical) so the rule and downstream consumers
    // see the canonical form. Fall back to the campaign's primary
    // tag only when the batch has no tag (rare; manually-created
    // batches).
    const tagForEvent = batch.batchTag ?? mapping.campaignId;

    try {
      await emit({
        type: "TrackerCampaignImported",
        workspaceId,
        payload: {
          batchId,
          trafficSourceId,
          device,
          voluumCampaignId: mapping.campaignId,
          tag: tagForEvent,
        },
        dedupeKey: `voluum_campaign:${mapping.campaignId}`,
      });
      batchesDetectedInCampaign++;
      log.info(
        { batchId, voluumCampaignId: mapping.campaignId, device, trafficSourceId },
        "[Detect] TrackerCampaignImported emitted",
      );
    } catch (err) {
      log.warn({ err, batchId, voluumCampaignId: mapping.campaignId }, "[Detect] TrackerCampaignImported emit failed — sync continues");
    }
  }

  // tasksAutoCompleted is no longer counted at the producer — the
  // engine's CompleteTask actions handle it inside the rule's tx.
  // The field is kept in the return shape for backwards compat with
  // the route's response payload; surface 0 so callers can detect the
  // migration without parsing log lines.
  return { batchesDetectedInCampaign, tasksAutoCompleted: 0 };
}

async function fetchVoluumReport(
  token: string,
  apiBaseUrl: string,
  dateFrom: string,
  dateTo: string,
  options: { voluumWorkspaceId: string; log: SyncLog },
): Promise<Array<{
  campaignId: string;
  campaignName: string;
  date: string;
  cost: number;
  revenue: number;
  profit: number;
  roi: number;
  visits: number;
  conversions: number;
  cr: number;
  epv: number;
  cpa: number;
}>> {
  const { log } = options;
  const voluumWorkspaceId = options.voluumWorkspaceId.trim();
  if (!voluumWorkspaceId) {
    throw new Error("fetchVoluumReport called without a voluumWorkspaceId — refusing unscoped Voluum report.");
  }

  const params = new URLSearchParams({
    from: `${dateFrom}T00:00`,
    to: `${dateTo}T23:00`,
    tz: "UTC",
    groupBy: "campaign,day",
    currency: "USD",
    // Voluum's report API uses the same `workspaceId` query param as the
    // entity endpoints. Sending it scopes the report rows to that workspace.
    workspaceId: voluumWorkspaceId,
  });

  const url = `${apiBaseUrl}/report?${params.toString()}`;
  log.info({ url, method: "GET", voluumWorkspaceId }, "Voluum report request");

  const res = await fetch(url, {
    headers: { "cwauth-token": token, "Accept": "application/json" },
  });

  log.info({ url, status: res.status, voluumWorkspaceId }, "Voluum report response");

  if (!res.ok) {
    const rawBody = await res.text();
    const cleanBody = sanitizeErrorBody(rawBody, res.status);
    log.warn({ url, status: res.status, body: cleanBody }, "Voluum report fetch failed");
    throw new Error(`Voluum connection failed. Please check the API endpoint and credentials. (${res.status})`);
  }

  const data = await res.json() as { rows?: Array<any> };
  const rawRows = data.rows ?? [];
  const rows = filterRawByWorkspace(rawRows, voluumWorkspaceId, log, "report-row");

  return rows.map((r: any) => ({
    campaignId: r.campaignId ?? r.campaign_id ?? "",
    campaignName: r.campaignName ?? r.campaign_name ?? "",
    date: (r.day ?? r.date ?? "").split("T")[0],
    cost: Number(r.cost ?? 0),
    revenue: Number(r.revenue ?? 0),
    profit: Number(r.profit ?? 0),
    roi: Number(r.roi ?? 0),
    visits: Number(r.visits ?? 0),
    conversions: Number(r.conversions ?? 0),
    cr: Number(r.cr ?? 0),
    epv: Number(r.epv ?? 0),
    cpa: Number(r.cpa ?? 0),
  }));
}

// Phase 11: per-offer visits report. Voluum's /report endpoint
// supports groupBy=offer; the visits column on each row is the
// per-offer total over the requested window. We persist this onto
// voluum_offers.visits so the BatchStatsUpdated rule can enforce the
// literal spec gate (every offer in the batch has visits >= 20000).
async function fetchVoluumOfferReport(
  token: string,
  apiBaseUrl: string,
  dateFrom: string,
  dateTo: string,
  options: { voluumWorkspaceId: string; log: SyncLog },
): Promise<Array<{ offerId: string; visits: number }>> {
  const { log } = options;
  const voluumWorkspaceId = options.voluumWorkspaceId.trim();
  if (!voluumWorkspaceId) {
    throw new Error("fetchVoluumOfferReport called without a voluumWorkspaceId — refusing unscoped report.");
  }
  const params = new URLSearchParams({
    from: `${dateFrom}T00:00`,
    to: `${dateTo}T23:00`,
    tz: "UTC",
    groupBy: "offer",
    currency: "USD",
    workspaceId: voluumWorkspaceId,
  });
  const url = `${apiBaseUrl}/report?${params.toString()}`;
  log.info({ url, method: "GET", voluumWorkspaceId }, "[Voluum] offer-report request");
  const res = await fetch(url, {
    headers: { "cwauth-token": token, "Accept": "application/json" },
  });
  log.info({ url, status: res.status, voluumWorkspaceId }, "[Voluum] offer-report response");
  if (!res.ok) {
    const cleanBody = sanitizeErrorBody(await res.text(), res.status);
    log.warn({ url, status: res.status, body: cleanBody }, "[Voluum] offer-report fetch failed (non-fatal)");
    return [];
  }
  const data = await res.json() as { rows?: Array<any> };
  const rawRows = data.rows ?? [];
  const rows = filterRawByWorkspace(rawRows, voluumWorkspaceId, log, "offer-report");
  return rows
    .map((r: any) => ({
      offerId: String(r.offerId ?? r.offer_id ?? r.id ?? ""),
      visits: Number(r.visits ?? 0),
    }))
    .filter((r: { offerId: string }) => r.offerId.length > 0);
}

function getDefaultDateRange(): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  return {
    dateFrom: sevenDaysAgo.toISOString().split("T")[0],
    dateTo: today.toISOString().split("T")[0],
  };
}

// Phase 1 (workspace isolation) removed the legacy `voluum_mapping_*` rows
// from `settings` and the `migrateLegacyMappings` shim that used to copy them
// into `voluum_campaign_mappings` at first call. The settings table is now
// strictly per-workspace, and mappings live exclusively in their own table.
async function ensureLegacyMigration(): Promise<void> {
  // no-op — kept as a stable call site so we don't have to touch every caller.
}

async function getAllMappings(
  workspaceId?: number | null,
  opts: { includeArchived?: boolean } = {},
): Promise<Array<{ id: number; workspaceId: number; campaignId: string; campaignName: string; batchId: number; deletedAt: Date | null; createdAt: Date }>> {
  await ensureLegacyMigration();

  const conditions: any[] = [];
  if (workspaceId) conditions.push(eq(voluumCampaignMappingsTable.workspaceId, workspaceId));
  if (!opts.includeArchived) conditions.push(isNull(voluumCampaignMappingsTable.deletedAt));

  const rows = conditions.length
    ? await db.select().from(voluumCampaignMappingsTable).where(and(...conditions))
    : await db.select().from(voluumCampaignMappingsTable);

  return rows;
}

/**
 * Returns true only if the caller asked for `?include_archived=true` AND
 * is an admin. Employees can never see archived/deleted entities.
 */
async function shouldIncludeArchived(req: import("express").Request): Promise<boolean> {
  if (req.query.include_archived !== "true") return false;
  const employee = await getEmployeeFromToken(req);
  return employee?.role === "admin";
}

// Phase 5a: extracted to ./sync/click-threshold.ts. The new module
// emits `BatchTested` (engine-owned status flip + FIND_WINNERS task
// come from Phase 4 rules) and is idempotent via the events
// dedupe-key index.
export { checkClickThresholds } from "./sync/click-threshold.ts";

// POST /sync/voluum/discovery-preview — credential-only dry-run preview.
// This route authenticates only; it emits no events and creates no tasks/batches.
router.post("/sync/voluum/discovery-preview", async (req, res): Promise<void> => {
  if (!isVoluumDryRunEnabled()) {
    res.status(410).json({
      error: "voluum_dry_run_disabled",
      message: "Voluum dry-run discovery preview is disabled.",
    });
    return;
  }

  const workspaceId = await requireWorkspaceFromBody(req, res);
  if (workspaceId === null) return;

  const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, workspaceId));
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  const accessId = ws.voluumAccessId?.trim() ?? "";
  const accessKey = ws.voluumAccessKey?.trim() ?? "";
  const credentials = accessId && accessKey
    ? await validateVoluumCredentialsOnly(accessId, accessKey)
    : { valid: false as const, code: "VOLUUM_CREDENTIALS_MISSING" as const };

  res.json({
    mode: "dry_run",
    workspaceId,
    enabled: true,
    credentials,
    sideEffects: {
      metadataFetches: false,
      dbWrites: false,
      events: false,
      tasks: false,
      batches: false,
    },
  });
});

// GET /sync/voluum/status?workspace_id=N — workspace-scoped sync status.
// Reads per-workspace credentials and timestamps from the workspaces row.
// The legacy unscoped variant (which read global voluum_* settings) was
// removed because it could leak status across workspaces.
router.get("/sync/voluum/status", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, workspaceId));
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  const isConfigured = !!(ws.voluumAccessId && ws.voluumAccessKey && ws.voluumWorkspaceId);
  res.json({
    workspaceId: ws.id,
    workspaceName: ws.name,
    voluumWorkspaceId: ws.voluumWorkspaceId,
    voluumWorkspaceName: ws.voluumWorkspaceName,
    lastSyncAt: ws.lastSyncAt ? ws.lastSyncAt.toISOString() : null,
    lastSyncStatus: ws.syncStatus,
    lastSyncMessage: null,
    lastSyncRowsImported: null,
    isConfigured,
  });
});

// POST /sync/voluum/trigger — workspace-scoped legacy sync trigger.
// Requires admin role AND a workspace_id (body or query). Uses the
// workspace's own credentials and only processes mappings for that workspace.
router.post("/sync/voluum/trigger", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;

  // Body chokepoint — also accept ?workspace_id= query for legacy clients.
  if (!req.body?.workspaceId && !req.body?.workspace_id && req.query.workspace_id) {
    req.body = { ...(req.body ?? {}), workspaceId: Number(req.query.workspace_id) };
  }
  const workspaceId = await requireWorkspaceFromBody(req, res);
  if (workspaceId === null) return;

  const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, workspaceId));
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  const accessId = ws.voluumAccessId;
  const accessKey = ws.voluumAccessKey;
  const apiBaseUrl = ws.voluumApiBaseUrl?.trim() || DEFAULT_VOLUUM_BASE_URL;
  const voluumWorkspaceId = ws.voluumWorkspaceId?.trim() || null;

  if (!accessId || !accessKey) {
    res.status(400).json({ error: "Voluum credentials not configured for this workspace." });
    return;
  }
  if (!voluumWorkspaceId) {
    res.status(400).json({
      error: "Voluum Workspace ID is not set for this workspace. Sync refuses to run unscoped — open Settings → Workspaces and set the Voluum Workspace ID first.",
    });
    return;
  }

  const { dateFrom, dateTo } = req.body?.dateFrom
    ? { dateFrom: req.body.dateFrom, dateTo: req.body.dateTo ?? new Date().toISOString().split("T")[0] }
    : getDefaultDateRange();

  const triggerLog = req.log.child({ workspaceId, voluumWorkspaceId });
  triggerLog.info({ apiBaseUrl, dateFrom, dateTo }, "Starting Voluum report sync");

  try {
    const token = await getVoluumToken(accessId, accessKey);
    const rawRows = await fetchVoluumReport(token, apiBaseUrl, dateFrom, dateTo, { voluumWorkspaceId, log: triggerLog });
    const { kept: rows } = validateWorkspaceItems(rawRows, voluumWorkspaceId, ws.voluumWorkspaceName, triggerLog, "report-row");
    const mappings = await getAllMappings(workspaceId);

    const mappingIndex = new Map(mappings.map(m => [m.campaignId, m.batchId]));

    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const batchId = mappingIndex.get(row.campaignId);
      if (!batchId) { skipped++; continue; }

      // Workspace assertion: refuse to write performance for a batch in a
      // different workspace, even if a stale/corrupt mapping points there.
      const [batch] = await db
        .select({ id: testingBatchesTable.id })
        .from(testingBatchesTable)
        .where(and(
          eq(testingBatchesTable.id, batchId),
          eq(testingBatchesTable.workspaceId, workspaceId),
        ));

      if (!batch) {
        triggerLog.warn(
          { batchId, workspaceId, campaignId: row.campaignId },
          "[sync] Mapping resolved to a batch outside the requested workspace — skipping",
        );
        skipped++;
        continue;
      }

      const epc = row.revenue > 0 && row.visits > 0 ? row.revenue / row.visits : 0;

      await db.delete(performanceTable).where(and(
        eq(performanceTable.batchId, batchId),
        eq(performanceTable.date, row.date)
      ));

      await db.insert(performanceTable).values({
        batchId,
        date: row.date,
        spend: row.cost.toFixed(4),
        clicks: row.visits,
        conversions: row.conversions,
        revenue: row.revenue.toFixed(4),
        profit: row.profit.toFixed(4),
        roi: row.roi.toFixed(4),
        cpa: row.cpa.toFixed(4),
        epc: epc.toFixed(4),
        cvr: row.cr.toFixed(4),
      } as any);

      imported++;
    }

    // Phase 11: per-offer visits ingestion. We pull the offer-grouped
    // report and write voluum_offers.visits, then emit BatchStatsUpdated
    // for every batch whose offers changed. The BatchStatsUpdated rule
    // enforces the literal spec gate: every offer in the batch must
    // have visits >= 20000 before the batch flips to TESTED.
    let offerVisitsPersisted = 0;
    let offerVisitsZeroed = 0;
    const visitsAffectedBatchIds = new Set<number>();
    try {
      const offerRows = await fetchVoluumOfferReport(token, apiBaseUrl, dateFrom, dateTo, {
        voluumWorkspaceId, log: triggerLog,
      });
      const reportedOfferIds = new Set(offerRows.map(r => r.offerId));
      for (const row of offerRows) {
        const [updated] = await db
          .update(voluumOffersTable)
          .set({ visits: row.visits })
          .where(and(
            eq(voluumOffersTable.workspaceId, workspaceId),
            eq(voluumOffersTable.offerId, row.offerId),
          ))
          .returning({ batchId: voluumOffersTable.batchId });
        if (updated) {
          offerVisitsPersisted++;
          if (updated.batchId != null) visitsAffectedBatchIds.add(updated.batchId);
        }
      }
      // Window-consistency: any active offer in this workspace NOT in
      // the current report had zero visits in the window. Reset to 0
      // so the BatchStatsUpdated gate (visits >= 20000) cannot be
      // falsely satisfied by stale values from an earlier window.
      const allOffers = await db
        .select({ id: voluumOffersTable.id, offerId: voluumOffersTable.offerId, batchId: voluumOffersTable.batchId, visits: voluumOffersTable.visits })
        .from(voluumOffersTable)
        .where(eq(voluumOffersTable.workspaceId, workspaceId));
      const offerIdsToZero = allOffers
        .filter(o => !reportedOfferIds.has(o.offerId) && o.visits !== 0)
        .map(o => o.id);
      if (offerIdsToZero.length > 0) {
        const zeroed = await db
          .update(voluumOffersTable)
          .set({ visits: 0 })
          .where(and(
            eq(voluumOffersTable.workspaceId, workspaceId),
            inArray(voluumOffersTable.id, offerIdsToZero),
          ))
          .returning({ batchId: voluumOffersTable.batchId });
        offerVisitsZeroed = zeroed.length;
        for (const z of zeroed) {
          if (z.batchId != null) visitsAffectedBatchIds.add(z.batchId);
        }
      }
      triggerLog.info({
        offerVisitsPersisted,
        offerVisitsZeroed,
        batchesNotified: visitsAffectedBatchIds.size,
      }, "[Sync] per-offer visits persisted");
    } catch (offerReportErr: any) {
      triggerLog.warn(
        { err: offerReportErr?.message },
        "[Sync] per-offer visits ingestion failed (non-fatal — campaign report still committed)",
      );
    }

    // Auto-check click thresholds for all mapped live/testing batches.
    // Union with batches whose per-offer visits just changed so the
    // engine re-evaluates the BatchStatsUpdated gate end-to-end.
    const mappedBatchIds = [...new Set(mappings.map(m => m.batchId))];
    const allBatchesToEvaluate = new Set<number>([...mappedBatchIds, ...visitsAffectedBatchIds]);
    await checkClickThresholds(workspaceId, [...allBatchesToEvaluate], req.log as any);
    for (const batchId of visitsAffectedBatchIds) {
      try {
        await emit({
          type: "BatchStatsUpdated",
          workspaceId,
          payload: { batchId },
        });
      } catch (emitErr: any) {
        triggerLog.warn(
          { err: emitErr?.message, batchId },
          "[Sync] BatchStatsUpdated emit failed (non-fatal)",
        );
      }
    }

    const syncedAt = new Date().toISOString();
    const message = `Synced ${imported} rows, skipped ${skipped} (no mapping).`;

    req.log.info({ imported, skipped }, "Voluum sync complete");

    await upsertSetting(workspaceId, "voluum_last_sync_at", syncedAt);
    await upsertSetting(workspaceId, "voluum_last_sync_status", "success");
    await upsertSetting(workspaceId, "voluum_last_sync_message", message);
    await upsertSetting(workspaceId, "voluum_last_sync_rows", String(imported));

    res.json({ success: true, rowsImported: imported, rowsSkipped: skipped, message, syncedAt });
  } catch (err: any) {
    const errorMsg = err?.message ?? "Unknown error during Voluum sync";
    const syncedAt = new Date().toISOString();

    req.log.error({ err: errorMsg }, "Voluum sync failed");

    await upsertSetting(workspaceId, "voluum_last_sync_at", syncedAt);
    await upsertSetting(workspaceId, "voluum_last_sync_status", "error");
    await upsertSetting(workspaceId, "voluum_last_sync_message", errorMsg);
    await upsertSetting(workspaceId, "voluum_last_sync_rows", "0");

    res.status(500).json({ error: errorMsg });
  }
});

// GET /sync/voluum/campaigns?workspace_id=N
// Live fetch of campaigns from Voluum, scoped to the workspace's Voluum
// workspace ID. Hard-fails if voluumWorkspaceId is missing.
router.get("/sync/voluum/campaigns", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, workspaceId));
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  const accessId = ws.voluumAccessId;
  const accessKey = ws.voluumAccessKey;
  const apiBaseUrl = ws.voluumApiBaseUrl?.trim() || DEFAULT_VOLUUM_BASE_URL;
  const voluumWorkspaceId = ws.voluumWorkspaceId?.trim() || null;

  if (!accessId || !accessKey) {
    res.status(400).json({ error: "Voluum credentials not configured for this workspace." });
    return;
  }
  if (!voluumWorkspaceId) {
    res.status(400).json({
      error: "Voluum Workspace ID is not set for this workspace. Refusing unscoped campaign fetch — set it in Settings → Workspaces first.",
    });
    return;
  }

  const fetchLog = req.log.child({ workspaceId, voluumWorkspaceId });
  fetchLog.info({ apiBaseUrl }, "Fetching Voluum campaigns (workspace-scoped)");

  try {
    const token = await getVoluumToken(accessId, accessKey);
    const rawCampaigns = await fetchVoluumCampaignsEnhanced(token, apiBaseUrl, { voluumWorkspaceId, log: fetchLog });
    const { kept: campaigns } = validateWorkspaceItems(rawCampaigns, voluumWorkspaceId, ws.voluumWorkspaceName, fetchLog, "campaign");
    fetchLog.info({ count: campaigns.length }, "Voluum campaigns fetched");
    res.json(campaigns);
  } catch (err: any) {
    const errorMsg = err?.message ?? "Failed to fetch campaigns";
    req.log.error({ err: errorMsg }, "Voluum campaigns fetch failed");
    res.status(500).json({ error: errorMsg });
  }
});

// GET /sync/voluum/mappings?workspace_id=N[&include_archived=true]
router.get("/sync/voluum/mappings", async (req, res): Promise<void> => {
  await ensureLegacyMigration();
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;
  const includeArchived = await shouldIncludeArchived(req);
  const mappings = await getAllMappings(workspaceId, { includeArchived });
  res.json(mappings.map(m => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
    deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
  })));
});

// POST /sync/voluum/mappings
router.post("/sync/voluum/mappings", async (req, res): Promise<void> => {
  const { campaignId, campaignName, batchId, workspaceId: reqWorkspaceId } = req.body;
  if (!campaignId || !batchId) {
    res.status(400).json({ error: "campaignId and batchId are required" });
    return;
  }

  const resolvedBatchId = Number(batchId);

  // Determine workspaceId from request body or derive from the target batch.
  // Both the source batch's workspace and any caller-supplied workspace must
  // be accessible to the requester to prevent cross-workspace mapping abuse.
  const [batch] = await db
    .select({ workspaceId: testingBatchesTable.workspaceId })
    .from(testingBatchesTable)
    .where(eq(testingBatchesTable.id, resolvedBatchId));
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  if (!batch.workspaceId) {
    res.status(400).json({ error: "Batch is missing workspaceId" });
    return;
  }
  const workspaceId: number = reqWorkspaceId ? Number(reqWorkspaceId) : batch.workspaceId;
  if (workspaceId !== batch.workspaceId) {
    res.status(400).json({ error: "workspaceId must match the batch's workspace" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, workspaceId)) === null) return;

  // Upsert by (workspaceId, campaignId)
  const [existing] = await db
    .select()
    .from(voluumCampaignMappingsTable)
    .where(and(
      eq(voluumCampaignMappingsTable.workspaceId, workspaceId),
      eq(voluumCampaignMappingsTable.campaignId, campaignId),
    ));

  if (existing) {
    // If the mapping was previously soft-deleted, restore it (deletedAt=null).
    const [updated] = await db
      .update(voluumCampaignMappingsTable)
      .set({ campaignName: campaignName ?? existing.campaignName, batchId: resolvedBatchId, deletedAt: null })
      .where(eq(voluumCampaignMappingsTable.id, existing.id))
      .returning();
    res.status(201).json({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      deletedAt: updated.deletedAt ? updated.deletedAt.toISOString() : null,
    });
  } else {
    const [inserted] = await db
      .insert(voluumCampaignMappingsTable)
      .values({ workspaceId, campaignId, campaignName: campaignName ?? "", batchId: resolvedBatchId, deletedAt: null })
      .returning();
    res.status(201).json({
      ...inserted,
      createdAt: inserted.createdAt.toISOString(),
      deletedAt: inserted.deletedAt ? inserted.deletedAt.toISOString() : null,
    });
  }
});

// DELETE /sync/voluum/mappings/:campaignId?workspace_id=N
// Soft delete: set deleted_at; never physically remove the row.
router.delete("/sync/voluum/mappings/:campaignId", async (req, res): Promise<void> => {
  const { campaignId } = req.params;
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const [deleted] = await db
    .update(voluumCampaignMappingsTable)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(voluumCampaignMappingsTable.campaignId, campaignId),
      eq(voluumCampaignMappingsTable.workspaceId, workspaceId),
      isNull(voluumCampaignMappingsTable.deletedAt),
    ))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Mapping not found" });
    return;
  }

  res.json({ success: true });
});

// ============================================================
// WORKSPACE MANAGEMENT
// ============================================================

/** Fetch available Voluum workspaces (GET /workspace). Non-fatal — some accounts may not expose this. */
async function fetchVoluumWorkspaces(
  token: string,
  apiBaseUrl: string,
  log: SyncLog,
): Promise<Array<{ id: string; name: string }>> {
  const url = `${apiBaseUrl}/workspace`;
  log.info({ url, method: "GET" }, "[Voluum] workspace list request");

  const res = await fetch(url, { headers: { "cwauth-token": token, "Accept": "application/json" } });
  log.info({ url, status: res.status }, "[Voluum] workspace list response");

  if (!res.ok) {
    const rawBody = await res.text();
    log.warn({ url, status: res.status, body: sanitizeErrorBody(rawBody, res.status) }, "[Voluum] workspace list non-fatal failure");
    return [];
  }

  const data = await res.json() as { payload?: Array<any>; rows?: Array<any>; elements?: Array<any> };
  const items = data.payload ?? data.rows ?? data.elements ?? [];
  log.info({ url, itemsReturned: items.length }, "[Voluum] workspaces parsed");

  return items.map((ws: any) => ({
    id: String(ws.id ?? ws.workspaceId ?? ""),
    name: String(ws.name ?? ws.workspaceName ?? ""),
  })).filter(ws => ws.id && ws.name);
}

type FetchDebug = {
  endpoint: string;
  httpStatus: number;
  contentType: string;
  rawBodySnippet: string;
  parsedCount: number;
  error: string | null;
};

type FetchResult<T> = { items: T[]; debug: FetchDebug };

/** Fetch traffic sources, optionally scoped to a Voluum workspace. */
async function fetchVoluumTrafficSources(
  token: string,
  apiBaseUrl: string,
  options: { voluumWorkspaceId?: string | null; log: SyncLog },
): Promise<FetchResult<{ id: string; name: string }>> {
  const { log } = options;
  // Always trim to remove accidental whitespace/tabs from user input
  const voluumWorkspaceId = options.voluumWorkspaceId?.trim() || null;
  const params = new URLSearchParams();
  if (voluumWorkspaceId) params.set("workspaceId", voluumWorkspaceId);
  const qs = params.size ? "?" + params.toString() : "";
  const url = `${apiBaseUrl}/traffic-source${qs}`;

  const debug: FetchDebug = { endpoint: url, httpStatus: 0, contentType: "", rawBodySnippet: "", parsedCount: 0, error: null };

  log.info({ url, method: "GET", voluumWorkspaceId }, "[Voluum] traffic sources request");

  let res: Response;
  try {
    res = await fetch(url, { headers: { "cwauth-token": token, "Accept": "application/json" } });
  } catch (netErr: any) {
    debug.error = `Network error: ${netErr?.message}`;
    log.error({ url, err: netErr?.message }, "[Voluum] traffic sources network error");
    throw new Error(`Network error fetching traffic sources: ${netErr?.message}`);
  }

  debug.httpStatus = res.status;
  debug.contentType = res.headers.get("content-type") ?? "";
  log.info({ url, status: res.status, contentType: debug.contentType }, "[Voluum] traffic sources response");

  const rawBody = await res.text();
  debug.rawBodySnippet = rawBody.slice(0, 1000);
  log.info({ url, status: res.status, rawBodySnippet: debug.rawBodySnippet }, "[Voluum] traffic sources raw body");

  if (!res.ok) {
    const cleanBody = sanitizeErrorBody(rawBody, res.status);
    debug.error = `HTTP ${res.status}: ${cleanBody}`;
    log.warn({ url, status: res.status, body: cleanBody }, "[Voluum] traffic sources fetch failed");
    throw new Error(`Failed to fetch traffic sources from Voluum (${res.status}): ${cleanBody}`);
  }

  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch (parseErr: any) {
    debug.error = `JSON parse error: ${parseErr?.message}. Body: ${rawBody.slice(0, 200)}`;
    log.error({ url, err: parseErr?.message, rawBodySnippet: rawBody.slice(0, 500) }, "[Voluum] traffic sources JSON parse error");
    throw new Error(`Failed to parse Voluum traffic sources response as JSON`);
  }

  const rawItems = data.payload ?? data.rows ?? data.elements ?? data.trafficSources ?? (Array.isArray(data) ? data : []);
  const items = filterRawByWorkspace(rawItems, voluumWorkspaceId, log, "traffic-source");
  debug.parsedCount = items.length;
  log.info({ url, itemsReturned: items.length, raw: rawItems.length, dataKeys: Object.keys(data) }, "[Voluum] traffic sources parsed");
  if (items.length > 0) log.info({ sample: JSON.stringify(items[0]).slice(0, 400) }, "[Voluum] traffic source sample item");

  const mapped = items.map((ts: any) => ({
    id: String(ts.id ?? ts.trafficSourceId ?? ""),
    name: String(ts.name ?? ts.trafficSourceName ?? ""),
  })).filter((ts: any) => ts.id && ts.name);

  return { items: mapped, debug };
}

/** Fetch affiliate networks, optionally scoped to a Voluum workspace. */
async function fetchVoluumAffiliateNetworks(
  token: string,
  apiBaseUrl: string,
  options: { voluumWorkspaceId?: string | null; log: SyncLog },
): Promise<FetchResult<{ id: string; name: string }>> {
  const { log } = options;
  // Always trim to remove accidental whitespace/tabs from user input
  const voluumWorkspaceId = options.voluumWorkspaceId?.trim() || null;
  const params = new URLSearchParams();
  if (voluumWorkspaceId) params.set("workspaceId", voluumWorkspaceId);
  const qs = params.size ? "?" + params.toString() : "";
  const url = `${apiBaseUrl}/affiliate-network${qs}`;

  const debug: FetchDebug = { endpoint: url, httpStatus: 0, contentType: "", rawBodySnippet: "", parsedCount: 0, error: null };

  log.info({ url, method: "GET", voluumWorkspaceId }, "[Voluum] affiliate networks request");

  let res: Response;
  try {
    res = await fetch(url, { headers: { "cwauth-token": token, "Accept": "application/json" } });
  } catch (netErr: any) {
    debug.error = `Network error: ${netErr?.message}`;
    log.error({ url, err: netErr?.message }, "[Voluum] affiliate networks network error");
    throw new Error(`Network error fetching affiliate networks: ${netErr?.message}`);
  }

  debug.httpStatus = res.status;
  debug.contentType = res.headers.get("content-type") ?? "";
  log.info({ url, status: res.status, contentType: debug.contentType }, "[Voluum] affiliate networks response");

  const rawBody = await res.text();
  debug.rawBodySnippet = rawBody.slice(0, 1000);
  log.info({ url, status: res.status, rawBodySnippet: debug.rawBodySnippet }, "[Voluum] affiliate networks raw body");

  if (!res.ok) {
    const cleanBody = sanitizeErrorBody(rawBody, res.status);
    debug.error = `HTTP ${res.status}: ${cleanBody}`;
    log.warn({ url, status: res.status, body: cleanBody }, "[Voluum] affiliate networks fetch failed");
    throw new Error(`Failed to fetch affiliate networks from Voluum (${res.status}): ${cleanBody}`);
  }

  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch (parseErr: any) {
    debug.error = `JSON parse error: ${parseErr?.message}. Body: ${rawBody.slice(0, 200)}`;
    log.error({ url, err: parseErr?.message, rawBodySnippet: rawBody.slice(0, 500) }, "[Voluum] affiliate networks JSON parse error");
    throw new Error(`Failed to parse Voluum affiliate networks response as JSON`);
  }

  const rawItems = data.payload ?? data.rows ?? data.elements ?? data.affiliateNetworks ?? (Array.isArray(data) ? data : []);
  const items = filterRawByWorkspace(rawItems, voluumWorkspaceId, log, "affiliate-network");
  debug.parsedCount = items.length;
  log.info({ url, itemsReturned: items.length, raw: rawItems.length, dataKeys: Object.keys(data) }, "[Voluum] affiliate networks parsed");
  if (items.length > 0) log.info({ sample: JSON.stringify(items[0]).slice(0, 400) }, "[Voluum] affiliate network sample item");

  const mapped = items.map((an: any) => ({
    id: String(an.id ?? an.affiliateNetworkId ?? ""),
    name: String(an.name ?? an.affiliateNetworkName ?? ""),
  })).filter((an: any) => an.id && an.name);

  return { items: mapped, debug };
}

async function ensureDefaultWorkspace(): Promise<void> {
  const existing = await db.select({ id: workspacesTable.id }).from(workspacesTable).limit(1);
  if (existing.length === 0) {
    // Create an empty default workspace. Voluum credentials must be entered
    // explicitly by an admin per workspace via Settings → Workspaces.
    // Legacy global voluum_* settings are intentionally NOT consulted here —
    // those globals are dangerous because they could mix data across workspaces.
    await db.insert(workspacesTable).values({
      name: "Default Workspace",
      description: "Primary OfferOps workspace",
      isActive: true,
      isDefault: true,
      syncInterval: "manual",
    });
  }
}

// GET /sync/voluum/workspaces — admin only (lists all workspaces system-wide;
// employees should use /api/auth/my-workspaces which is access-scoped).
router.get("/sync/voluum/workspaces", async (req, res): Promise<void> => {
  const employee = await requireAdmin(req, res);
  if (employee === null) return;
  await ensureDefaultWorkspace();
  const workspaces = await db.select().from(workspacesTable).orderBy(workspacesTable.id);
  res.json(workspaces.map((workspace) => serializeWorkspaceForEmployee(workspace, employee, workspaces)));
});

// POST /sync/voluum/workspaces — admin only
router.post("/sync/voluum/workspaces", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;
  const { name, description, voluumAccessId, voluumAccessKey, voluumApiBaseUrl, syncInterval } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const [workspace] = await db.insert(workspacesTable).values({
    name,
    description: description ?? null,
    voluumAccessId: voluumAccessId ?? null,
    voluumAccessKey: voluumAccessKey ?? null,
    voluumApiBaseUrl: voluumApiBaseUrl ?? null,
    syncInterval: syncInterval ?? "manual",
    isActive: false,
    isDefault: false,
  }).returning();
  req.log.info({ workspaceId: workspace.id, name }, "Workspace created");
  res.status(201).json(workspace);
});

// PATCH /sync/voluum/workspaces/:id — admin only
router.patch("/sync/voluum/workspaces/:id", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;
  const id = Number(req.params.id);
  const { name, description, voluumAccessId, voluumAccessKey, voluumApiBaseUrl, voluumWorkspaceId, voluumWorkspaceName, syncInterval } = req.body;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (voluumAccessId !== undefined) updates.voluumAccessId = voluumAccessId;
  if (voluumAccessKey !== undefined) updates.voluumAccessKey = voluumAccessKey;
  if (voluumApiBaseUrl !== undefined) updates.voluumApiBaseUrl = voluumApiBaseUrl;
  if (voluumWorkspaceId !== undefined) updates.voluumWorkspaceId = voluumWorkspaceId?.trim() || null;
  if (voluumWorkspaceName !== undefined) updates.voluumWorkspaceName = voluumWorkspaceName?.trim() || null;
  if (syncInterval !== undefined) updates.syncInterval = syncInterval;

  const [workspace] = await db
    .update(workspacesTable)
    .set(updates as any)
    .where(eq(workspacesTable.id, id))
    .returning();

  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  req.log.info({ workspaceId: id }, "Workspace updated");
  res.json(workspace);
});

// DELETE /sync/voluum/workspaces/:id — admin only
router.delete("/sync/voluum/workspaces/:id", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;
  const id = Number(req.params.id);
  const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, id));
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if (ws.isDefault) {
    res.status(400).json({ error: "Cannot delete the default workspace" });
    return;
  }
  await db.delete(voluumTrafficSourcesTable).where(eq(voluumTrafficSourcesTable.workspaceId, id));
  await db.delete(voluumAffiliateNetworksTable).where(eq(voluumAffiliateNetworksTable.workspaceId, id));
  await db.delete(voluumCampaignsTable).where(eq(voluumCampaignsTable.workspaceId, id));
  await db.delete(voluumOffersTable).where(eq(voluumOffersTable.workspaceId, id));
  await db.delete(workspacesTable).where(eq(workspacesTable.id, id));
  req.log.info({ workspaceId: id }, "Workspace deleted");
  res.json({ success: true });
});

// POST /sync/voluum/workspaces/:id/sync — workspace member or admin
router.post("/sync/voluum/workspaces/:id/sync", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, id));
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, id)) === null) return;

  const accessId = ws.voluumAccessId;
  const accessKey = ws.voluumAccessKey;
  const apiBaseUrl = (ws.voluumApiBaseUrl?.trim()) || DEFAULT_VOLUUM_BASE_URL;
  // Always trim the workspace ID — prevents issues from copy-paste whitespace/tabs
  const voluumWorkspaceId = ws.voluumWorkspaceId?.trim() || null;

  if (!accessId || !accessKey) {
    res.status(400).json({ error: "Workspace has no Voluum credentials configured. Add Access ID and Access Key to sync." });
    return;
  }
  if (!voluumWorkspaceId) {
    res.status(400).json({
      error: "Voluum Workspace ID is not set for this workspace. Sync refuses to run unscoped — use the Test button to discover available Voluum workspaces, then save the correct ID.",
    });
    return;
  }

  const syncLog = req.log.child({ workspaceId: id, workspaceName: ws.name, voluumWorkspaceId });
  syncLog.info({ apiBaseUrl, voluumWorkspaceId }, "[Sync] Starting workspace metadata sync");

  await db.update(workspacesTable).set({ syncStatus: "syncing", updatedAt: new Date() }).where(eq(workspacesTable.id, id));

  try {
    const token = await getVoluumToken(accessId, accessKey);

    const tsResult = await fetchVoluumTrafficSources(token, apiBaseUrl, { voluumWorkspaceId, log: syncLog });
    const anResult = await fetchVoluumAffiliateNetworks(token, apiBaseUrl, { voluumWorkspaceId, log: syncLog });

    // Hard validation — discard any item that, when self-described, doesn't
    // belong to the configured Voluum workspace. Keeps cross-workspace rows
    // from ever reaching the DB.
    const tsValidated = validateWorkspaceItems(tsResult.items, voluumWorkspaceId, ws.voluumWorkspaceName, syncLog, "traffic-source");
    const anValidated = validateWorkspaceItems(anResult.items, voluumWorkspaceId, ws.voluumWorkspaceName, syncLog, "affiliate-network");
    const trafficSources = tsValidated.kept;
    const affiliateNetworks = anValidated.kept;

    const warnings: string[] = [];
    if (trafficSources.length === 0 && !voluumWorkspaceId) {
      warnings.push("Voluum returned 0 traffic sources. If you have multiple Voluum workspaces, set a Voluum Workspace ID to scope the request.");
    }
    if (trafficSources.length === 0 && voluumWorkspaceId) {
      warnings.push(`Voluum returned 0 traffic sources even with workspace ID "${voluumWorkspaceId}". Check that this is the correct workspace ID (use the Test button to discover available workspaces).`);
    }
    if (affiliateNetworks.length === 0 && !voluumWorkspaceId) {
      warnings.push("Voluum returned 0 affiliate networks. If you have multiple Voluum workspaces, set a Voluum Workspace ID to scope the request.");
    }
    if (affiliateNetworks.length === 0 && voluumWorkspaceId) {
      warnings.push(`Voluum returned 0 affiliate networks even with workspace ID "${voluumWorkspaceId}". Check that this is the correct workspace ID.`);
    }

    // --- Upsert traffic sources with detailed tracking ---
    // Soft-delete pattern: tombstone everything for this workspace, then
    // un-tombstone (deletedAt=null) only what Voluum returned this sync.
    // Anything not returned stays deletedAt=<now> and is hidden from queries.
    const nowTs = new Date();
    let tsImported = 0, tsUpdated = 0, tsSkipped = 0, tsErrors = 0;
    await db.update(voluumTrafficSourcesTable)
      .set({ isActive: false, deletedAt: nowTs })
      .where(and(
        eq(voluumTrafficSourcesTable.workspaceId, id),
        isNull(voluumTrafficSourcesTable.deletedAt),
      ));
    for (const ts of trafficSources) {
      try {
        const [existing] = await db.select().from(voluumTrafficSourcesTable).where(
          and(eq(voluumTrafficSourcesTable.workspaceId, id), eq(voluumTrafficSourcesTable.voluumId, ts.id))
        );
        if (existing) {
          const nameChanged = existing.name !== ts.name;
          await db.update(voluumTrafficSourcesTable)
            .set({ name: ts.name, isActive: true, deletedAt: null, syncedAt: nowTs })
            .where(eq(voluumTrafficSourcesTable.id, existing.id));
          if (nameChanged) tsUpdated++; else tsSkipped++;
        } else {
          await db.insert(voluumTrafficSourcesTable).values({ workspaceId: id, voluumId: ts.id, name: ts.name, isActive: true, deletedAt: null, syncedAt: nowTs });
          tsImported++;
        }
      } catch (e: any) {
        tsErrors++;
        syncLog.error({ err: e?.message, tsId: ts.id, tsName: ts.name }, "[Sync] Error upserting traffic source");
      }
    }
    syncLog.info({ returned: trafficSources.length, imported: tsImported, updated: tsUpdated, skipped: tsSkipped, errors: tsErrors }, "[Sync] Traffic sources upsert complete");

    // --- Upsert affiliate networks with detailed tracking ---
    let anImported = 0, anUpdated = 0, anSkipped = 0, anErrors = 0;
    await db.update(voluumAffiliateNetworksTable)
      .set({ isActive: false, deletedAt: nowTs })
      .where(and(
        eq(voluumAffiliateNetworksTable.workspaceId, id),
        isNull(voluumAffiliateNetworksTable.deletedAt),
      ));
    for (const an of affiliateNetworks) {
      try {
        const [existing] = await db.select().from(voluumAffiliateNetworksTable).where(
          and(eq(voluumAffiliateNetworksTable.workspaceId, id), eq(voluumAffiliateNetworksTable.voluumId, an.id))
        );
        if (existing) {
          const nameChanged = existing.name !== an.name;
          await db.update(voluumAffiliateNetworksTable)
            .set({ name: an.name, isActive: true, deletedAt: null, syncedAt: nowTs })
            .where(eq(voluumAffiliateNetworksTable.id, existing.id));
          if (nameChanged) anUpdated++; else anSkipped++;
        } else {
          await db.insert(voluumAffiliateNetworksTable).values({ workspaceId: id, voluumId: an.id, name: an.name, isActive: true, deletedAt: null, syncedAt: nowTs });
          anImported++;
        }
      } catch (e: any) {
        anErrors++;
        syncLog.error({ err: e?.message, anId: an.id, anName: an.name }, "[Sync] Error upserting affiliate network");
      }
    }
    syncLog.info({ returned: affiliateNetworks.length, imported: anImported, updated: anUpdated, skipped: anSkipped, errors: anErrors }, "[Sync] Affiliate networks upsert complete");

    // --- Sync campaigns ---
    let campaigns: Awaited<ReturnType<typeof fetchVoluumCampaignsEnhanced>> = [];
    try {
      campaigns = await fetchVoluumCampaignsEnhanced(token, apiBaseUrl, { voluumWorkspaceId, log: syncLog });
    } catch (e: any) {
      syncLog.warn({ err: e?.message }, "[Sync] Campaign fetch non-fatal error");
    }

    // Hard workspace validation on campaigns
    const campaignsValidated = validateWorkspaceItems(campaigns, voluumWorkspaceId, ws.voluumWorkspaceName, syncLog, "campaign");
    campaigns = campaignsValidated.kept;

    // --- Tag classification (no filtering): every campaign is upserted so it
    // remains visible in the UI. We only attach a canonical primaryTag when
    // the campaign carries a valid OfferOps tag; allTags is always persisted.
    // Pattern: {affiliateInitials}_{geo}_batch{number}
    const campaignSkipCounts: Record<VoluumTagSkipReason, number> = {
      missing_tag: 0,
      invalid_tag_format: 0,
      unknown_affiliate_initials: 0,
      invalid_geo: 0,
      invalid_batch_number: 0,
    };
    type ClassifiedCampaign = (typeof campaigns)[number] & {
      primaryTag: string | null;
      // SPEC §1: when a campaign carries tracker-shaped tags but none
      // are valid (per SPEC §4 grammar), it must be ignored completely
      // — no DB persistence, no UI visibility. We still emit a single
      // VoluumCampaignTagInvalid event so admins get a notification.
      skipPersistInvalidTracker: boolean;
      invalidTrackerReason: TrackerCampaignTagSkipReason | null;
      invalidTrackerOffender: string | null;
    };
    const looksLikeTrackerTag = (t: string): boolean => {
      const parts = t.split("_");
      return parts.length === 4 && /^batch[0-9]+$/i.test(parts[2] ?? "");
    };
    const classifiedCampaigns: ClassifiedCampaign[] = [];
    let taggedCampaignCount = 0;
    let invalidTrackerSkipped = 0;
    for (const camp of campaigns) {
      // First-pass: tracker-shape filter (SPEC §1 strict skip).
      const trackerShaped = camp.allTags.filter(looksLikeTrackerTag);
      let invalidTrackerReason: TrackerCampaignTagSkipReason | null = null;
      let invalidTrackerOffender: string | null = null;
      let skipPersistInvalidTracker = false;
      if (trackerShaped.length > 0) {
        let anyValid = false;
        for (const t of trackerShaped) {
          const r = validateTrackerCampaignTag(t);
          if (r.valid) { anyValid = true; break; }
          if (invalidTrackerReason === null) {
            invalidTrackerReason = r.reason;
            invalidTrackerOffender = r.offendingTag;
          }
        }
        if (!anyValid) {
          skipPersistInvalidTracker = true;
          invalidTrackerSkipped++;
        }
      }

      const result = pickValidVoluumTag(camp.allTags);
      if (result.valid) {
        classifiedCampaigns.push({
          ...camp,
          primaryTag: result.parsed.tag,
          skipPersistInvalidTracker,
          invalidTrackerReason,
          invalidTrackerOffender,
        });
        taggedCampaignCount++;
      } else {
        campaignSkipCounts[result.reason]++;
        classifiedCampaigns.push({
          ...camp,
          primaryTag: null,
          skipPersistInvalidTracker,
          invalidTrackerReason,
          invalidTrackerOffender,
        });
      }
    }
    if (invalidTrackerSkipped > 0) {
      syncLog.info(
        { count: invalidTrackerSkipped },
        "[Sync] SPEC §1: tracker-shaped campaigns with invalid tags will be skipped from persistence",
      );
    }
    const untaggedCampaigns = campaigns.length - taggedCampaignCount;
    if (untaggedCampaigns > 0) {
      syncLog.info({
        untagged: untaggedCampaigns,
        tagged: taggedCampaignCount,
        total: campaigns.length,
        byReason: campaignSkipCounts,
      }, "[Sync] Campaign tag-classification summary");
    }

    // Voluum status values that mean "this entity is gone — hide from UI".
    // Comparison is case-insensitive against the raw string.
    const ARCHIVED_STATUSES = new Set(["DELETED", "ARCHIVED", "INACTIVE"]);

    let campsImported = 0, campsUpdated = 0, campsArchivedByStatus = 0;
    await db.update(voluumCampaignsTable)
      .set({ isActive: false, deletedAt: nowTs })
      .where(and(
        eq(voluumCampaignsTable.workspaceId, id),
        isNull(voluumCampaignsTable.deletedAt),
      ));
    for (const camp of classifiedCampaigns) {
      // SPEC §1 strict skip: tracker-shaped tag with no valid form must
      // be ignored completely. Emit one notification (the engine fans
      // out to admins) and do NOT persist the row.
      if (camp.skipPersistInvalidTracker) {
        try {
          await emit({
            type: "VoluumCampaignTagInvalid",
            workspaceId: id,
            payload: {
              voluumCampaignId: camp.campaignId,
              voluumCampaignName: camp.campaignName,
              offendingTag: camp.invalidTrackerOffender,
              reason: camp.invalidTrackerReason ?? "invalid_tag_format",
            },
            dedupeKey: `invalid_tag:${camp.campaignId}:${camp.invalidTrackerReason ?? "invalid_tag_format"}`,
          });
        } catch (err) {
          syncLog.warn(
            { err, voluumCampaignId: camp.campaignId },
            "[Sync] VoluumCampaignTagInvalid emit failed — continuing without persisting",
          );
        }
        continue;
      }
      // Persist every other campaign (tagged or untagged) so it remains
      // visible in the UI. primaryTag is set only when the campaign
      // carries a valid OfferOps tag; allTags is always JSON-encoded for
      // completeness. Auto-mapping uses primary_tag to link campaigns to
      // batches that share the same tag.
      const { allTags: campTagsArr, primaryTag: _pt, skipPersistInvalidTracker: _spi, invalidTrackerReason: _itr, invalidTrackerOffender: _ito, ...campRow } = camp;
      void _pt; void _spi; void _itr; void _ito;
      const archivedByStatus = !!camp.status && ARCHIVED_STATUSES.has(camp.status.toUpperCase());
      const baseRow = {
        ...campRow,
        primaryTag: camp.primaryTag,
        allTags: JSON.stringify(campTagsArr),
      };
      const setOnReturn = archivedByStatus
        ? { ...baseRow, isActive: false, deletedAt: nowTs, syncedAt: nowTs }
        : { ...baseRow, isActive: true, deletedAt: null, syncedAt: nowTs };
      if (archivedByStatus) campsArchivedByStatus++;
      try {
        const [existing] = await db.select({ id: voluumCampaignsTable.id })
          .from(voluumCampaignsTable)
          .where(and(eq(voluumCampaignsTable.workspaceId, id), eq(voluumCampaignsTable.campaignId, camp.campaignId)));
        if (existing) {
          await db.update(voluumCampaignsTable)
            .set(setOnReturn)
            .where(eq(voluumCampaignsTable.id, existing.id));
          campsUpdated++;
        } else {
          await db.insert(voluumCampaignsTable).values({ workspaceId: id, ...setOnReturn });
          campsImported++;
        }
      } catch (e: any) {
        syncLog.error({ err: e?.message, campaignId: camp.campaignId }, "[Sync] Error upserting campaign");
      }
    }
    if (campsArchivedByStatus > 0) {
      syncLog.info({ count: campsArchivedByStatus }, "[Sync] Campaigns hidden due to Voluum status (DELETED/ARCHIVED/INACTIVE)");
    }
    syncLog.info({
      returned: campaigns.length,
      imported: campsImported,
      updated: campsUpdated,
      tagged: taggedCampaignCount,
      untagged: untaggedCampaigns,
    }, "[Sync] Campaigns upsert complete");

    // --- Sync offers ---
    let offers: Awaited<ReturnType<typeof fetchVoluumOffers>> = [];
    try {
      offers = await fetchVoluumOffers(token, apiBaseUrl, { voluumWorkspaceId, log: syncLog });
    } catch (e: any) {
      syncLog.warn({ err: e?.message }, "[Sync] Offers fetch non-fatal error");
    }

    // Hard workspace validation on offers
    const offersValidated = validateWorkspaceItems(offers, voluumWorkspaceId, ws.voluumWorkspaceName, syncLog, "offer");
    offers = offersValidated.kept;

    // --- Tag filter: ONLY import offers with at least one valid OfferOps tag ---
    // Pattern: {affiliateInitials}_{geo}_batch{number}
    // (e.g. sl_de_batch1). The matched tag becomes the canonical primaryTag
    // used by auto-grouping. Invalid items are skipped before DB insert.
    const offerSkipCounts: Record<VoluumTagSkipReason, number> = {
      missing_tag: 0,
      invalid_tag_format: 0,
      unknown_affiliate_initials: 0,
      invalid_geo: 0,
      invalid_batch_number: 0,
    };
    type ImportableOffer = (typeof offers)[number] & { primaryTag: string };
    const taggedOffers: ImportableOffer[] = [];
    for (const offer of offers) {
      const result = pickValidVoluumTag(offer.allTags);
      if (!result.valid) {
        offerSkipCounts[result.reason]++;
        syncLog.warn({
          kind: "offer",
          offerId: offer.offerId,
          offerName: offer.offerName,
          reason: result.reason,
          tags: result.allTags,
          offendingTag: result.offendingTag,
        }, "[Sync] Skipping offer — no valid OfferOps tag");
        continue;
      }
      taggedOffers.push({ ...offer, primaryTag: result.parsed.tag });
    }
    const skippedUntaggedOffers = offers.length - taggedOffers.length;
    if (skippedUntaggedOffers > 0) {
      syncLog.info({
        skipped: skippedUntaggedOffers,
        total: offers.length,
        byReason: offerSkipCounts,
      }, "[Sync] Offer tag-validation summary");
    }

    let offersImported = 0, offersUpdated = 0, offersArchivedByStatus = 0;
    // Tombstone all existing offers for this workspace, then un-tombstone
    // only the ones Voluum returned in this sync (and that aren't archived
    // upstream). Hidden offers stay in the DB but disappear from the UI.
    await db.update(voluumOffersTable)
      .set({ isActive: false, deletedAt: nowTs })
      .where(and(
        eq(voluumOffersTable.workspaceId, id),
        isNull(voluumOffersTable.deletedAt),
      ));
    for (const offer of taggedOffers) {
      try {
        // voluum_offers.all_tags is a TEXT column storing JSON-encoded tags.
        const offerRow = { ...offer, allTags: JSON.stringify(offer.allTags) };
        const archivedByStatus = !!offer.status && ARCHIVED_STATUSES.has(offer.status.toUpperCase());
        const setOnReturn = archivedByStatus
          ? { ...offerRow, isActive: false, deletedAt: nowTs, syncedAt: nowTs }
          : { ...offerRow, isActive: true, deletedAt: null, syncedAt: nowTs };
        if (archivedByStatus) offersArchivedByStatus++;
        const [existing] = await db.select({ id: voluumOffersTable.id })
          .from(voluumOffersTable)
          .where(and(eq(voluumOffersTable.workspaceId, id), eq(voluumOffersTable.offerId, offer.offerId)));
        if (existing) {
          await db.update(voluumOffersTable)
            .set(setOnReturn)
            .where(eq(voluumOffersTable.id, existing.id));
          offersUpdated++;
        } else {
          const [inserted] = await db.insert(voluumOffersTable)
            .values({ workspaceId: id, ...setOnReturn })
            .returning({ id: voluumOffersTable.id });
          offersImported++;

          // Phase 5b (Task #15): emit OfferImported into the engine. The
          // Phase 4 handler is currently a no-op stub; this populates
          // the event log + dedupe index so future Phase 5c batch-
          // creation logic can be moved off `autoGroupOffersIntoBatches`
          // without losing history. Dedupe key is the Voluum offer id —
          // re-syncing the same offer (insert race or replay) is a
          // no-op via the partial unique index on events(dedupe_key).
          try {
            const reparsed = pickValidVoluumTag([offer.primaryTag]);
            if (reparsed.valid && inserted) {
              await emit({
                type: "OfferImported",
                workspaceId: id,
                payload: {
                  voluumOfferId: offer.offerId,
                  offerId: inserted.id,
                  tag: offer.primaryTag,
                  affiliateNetworkName: reparsed.parsed.affiliateInitials,
                  geo: reparsed.parsed.geo,
                },
                dedupeKey: `voluum_offer:${offer.offerId}`,
              });
            }
          } catch (emitErr: any) {
            // Engine emit failures must not break the sync — they are
            // observable via the tombstone row written by event-bus.ts.
            syncLog.warn({ err: emitErr?.message, voluumOfferId: offer.offerId }, "[Sync] OfferImported emit failed (tombstoned)");
          }
        }
      } catch (e: any) {
        syncLog.error({ err: e?.message, offerId: offer.offerId }, "[Sync] Error upserting offer");
      }
    }
    if (offersArchivedByStatus > 0) {
      syncLog.info({ count: offersArchivedByStatus }, "[Sync] Offers hidden due to Voluum status (DELETED/ARCHIVED/INACTIVE)");
    }
    syncLog.info({
      returned: offers.length,
      taggedImported: offersImported,
      taggedUpdated: offersUpdated,
      skippedUntagged: skippedUntaggedOffers,
    }, "[Sync] Offers upsert complete");

    // --- Auto-group offers into batches by tag ---
    let batchesCreated = 0;
    let offersGrouped = 0;
    if (taggedOffers.length > 0) {
      try {
        const groupResult = await autoGroupOffersIntoBatches(id, syncLog);
        batchesCreated = groupResult.batchesCreated;
        offersGrouped = groupResult.offersGrouped;
      } catch (e: any) {
        syncLog.warn({ err: e?.message }, "[Sync] Auto-group offers non-fatal error");
      }
    } else {
      // Even when there are no taggable offers this run, campaigns may have
      // been freshly tagged in Voluum. Run the auto-mapping/detection pass
      // unconditionally so existing batches still link to their campaigns
      // and create_test_campaign tasks auto-complete.
      try {
        await detectBatchesInVoluumCampaigns(id, new Date(), syncLog);
      } catch (e: any) {
        syncLog.warn({ err: e?.message }, "[Sync] Standalone detect non-fatal error");
      }
    }

    // SPEC Phase 1: post-sync reconciliation pass (verification only).
    // autoGroupOffersIntoBatches already ran above (or was deliberately
    // skipped for empty syncs), so this call deliberately omits the
    // runAutoGroup callback to avoid double work.
    try {
      const { reconcileWorkspace } = await import("../engine/reconciliation/index.ts");
      await reconcileWorkspace(id, syncLog as never);
    } catch (e: any) {
      syncLog.warn({ err: e?.message }, "[Sync] Reconciliation pass non-fatal error");
    }

    const syncedAt = new Date();
    const hasErrors = tsErrors > 0 || anErrors > 0;
    const finalStatus = hasErrors ? "error" : "success";

    await db.update(workspacesTable).set({
      syncStatus: finalStatus,
      lastSyncAt: syncedAt,
      trafficSourcesSynced: trafficSources.length,
      networksSynced: affiliateNetworks.length,
      updatedAt: syncedAt,
    }).where(eq(workspacesTable.id, id));

    // --- Backfill Voluum IDs on batches and plans (name match), propagate name changes ---
    syncLog.info("[Sync] Running Voluum ID backfill on batches and plans");
    try {
      // Backfill trafficSourceVoluumId on testing_batches (name → voluumId)
      await db.execute(sql`
        UPDATE testing_batches tb
        SET traffic_source_voluum_id = vts.voluum_id
        FROM voluum_traffic_sources vts
        WHERE vts.workspace_id = ${id}
          AND vts.is_active = true
          AND tb.traffic_source = vts.name
          AND tb.traffic_source_voluum_id IS NULL
      `);
      // Propagate TS name changes on testing_batches (voluumId → updated name)
      await db.execute(sql`
        UPDATE testing_batches tb
        SET traffic_source = vts.name
        FROM voluum_traffic_sources vts
        WHERE vts.workspace_id = ${id}
          AND tb.traffic_source_voluum_id = vts.voluum_id
          AND tb.traffic_source IS DISTINCT FROM vts.name
      `);
      // Backfill affiliateNetworkVoluumId on testing_batches
      await db.execute(sql`
        UPDATE testing_batches tb
        SET affiliate_network_voluum_id = van.voluum_id
        FROM voluum_affiliate_networks van
        WHERE van.workspace_id = ${id}
          AND van.is_active = true
          AND tb.affiliate_network = van.name
          AND tb.affiliate_network_voluum_id IS NULL
      `);
      // Propagate AN name changes on testing_batches
      await db.execute(sql`
        UPDATE testing_batches tb
        SET affiliate_network = van.name
        FROM voluum_affiliate_networks van
        WHERE van.workspace_id = ${id}
          AND tb.affiliate_network_voluum_id = van.voluum_id
          AND tb.affiliate_network IS DISTINCT FROM van.name
      `);
      // Phase 8b (Task #18): the four `traffic_source_plans` backfill
      // updates that lived here are gone — that table was dropped along
      // with its CRUD route. The replacement, `workspace_traffic_sources`,
      // doesn't carry per-(network, geo) rows, so the
      // testing_batches backfills above are sufficient.
      syncLog.info("[Sync] Voluum ID backfill complete");
    } catch (backfillErr: any) {
      syncLog.warn({ err: backfillErr?.message }, "[Sync] Voluum ID backfill failed (non-fatal)");
    }

    syncLog.info({
      status: finalStatus,
      trafficSources: { returned: trafficSources.length, imported: tsImported, updated: tsUpdated, skipped: tsSkipped, errors: tsErrors },
      affiliateNetworks: { returned: affiliateNetworks.length, imported: anImported, updated: anUpdated, skipped: anSkipped, errors: anErrors },
      warnings,
    }, "[Sync] Workspace sync complete");

    res.json({
      success: true,
      trafficSourcesImported: tsImported,
      affiliateNetworksImported: anImported,
      trafficSourcesUpdated: tsUpdated,
      affiliateNetworksUpdated: anUpdated,
      trafficSourcesSkipped: tsSkipped,
      affiliateNetworksSkipped: anSkipped,
      trafficSourceErrors: tsErrors,
      affiliateNetworkErrors: anErrors,
      trafficSourcesSynced: trafficSources.length,
      networksSynced: affiliateNetworks.length,
      campaignsSynced: classifiedCampaigns.length,
      campaignsFetched: campaigns.length,
      taggedCampaigns: taggedCampaignCount,
      untaggedCampaigns,
      importedCampaigns: campsImported,
      campaignsImported: campsImported,
      campaignsUpdated: campsUpdated,
      offersSynced: taggedOffers.length,
      offersFetched: offers.length,
      skippedUntaggedOffers,
      importedTaggedOffers: offersImported,
      offersImported,
      offersUpdated,
      batchesCreated,
      offersGrouped,
      voluumWorkspaceId,
      warnings,
      syncedAt: syncedAt.toISOString(),
      debug: {
        trafficSources: tsResult.debug,
        affiliateNetworks: anResult.debug,
      },
    });
  } catch (err: any) {
    const errorMsg = err?.message ?? "Sync failed";
    await db.update(workspacesTable).set({ syncStatus: "error", updatedAt: new Date() }).where(eq(workspacesTable.id, id));
    syncLog.error({ err: errorMsg }, "[Sync] Workspace sync failed");
    res.status(500).json({ error: errorMsg });
  }
});

// POST /sync/voluum/workspaces/:id/test-metadata
// Dry-run: fetches Voluum workspaces, traffic sources, and affiliate networks without writing to DB
router.post("/sync/voluum/workspaces/:id/test-metadata", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, id));
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, id)) === null) return;

  const accessId = ws.voluumAccessId;
  const accessKey = ws.voluumAccessKey;
  const apiBaseUrl = (ws.voluumApiBaseUrl?.trim()) || DEFAULT_VOLUUM_BASE_URL;
  // Always trim to prevent tab/whitespace issues from copy-paste
  // For the test-metadata route we ALLOW a missing voluumWorkspaceId because
  // its primary purpose is to *discover* workspaces so the admin can pick one.
  const voluumWorkspaceId = ws.voluumWorkspaceId?.trim() || null;

  if (!accessId || !accessKey) {
    res.status(400).json({ error: "Workspace has no Voluum credentials configured." });
    return;
  }

  const testLog = req.log.child({ workspaceId: id, workspaceName: ws.name, voluumWorkspaceId });
  testLog.info({ apiBaseUrl, voluumWorkspaceId }, "[TestMetadata] Starting metadata test");

  try {
    const token = await getVoluumToken(accessId, accessKey);

    const [voluumWorkspaces, tsResult, anResult] = await Promise.all([
      fetchVoluumWorkspaces(token, apiBaseUrl, testLog),
      fetchVoluumTrafficSources(token, apiBaseUrl, { voluumWorkspaceId, log: testLog }),
      fetchVoluumAffiliateNetworks(token, apiBaseUrl, { voluumWorkspaceId, log: testLog }),
    ]);

    testLog.info({
      voluumWorkspaces: voluumWorkspaces.length,
      trafficSources: tsResult.items.length,
      affiliateNetworks: anResult.items.length,
    }, "[TestMetadata] Test complete");

    // Always return arrays — frontend assumes these are never null/undefined.
    res.json({
      voluumWorkspaces: Array.isArray(voluumWorkspaces) ? voluumWorkspaces : [],
      trafficSources: Array.isArray(tsResult?.items) ? tsResult.items : [],
      affiliateNetworks: Array.isArray(anResult?.items) ? anResult.items : [],
      debug: {
        trafficSources: tsResult?.debug ?? {},
        affiliateNetworks: anResult?.debug ?? {},
      },
    });
  } catch (err: any) {
    const errorMsg = err?.message ?? "Test metadata fetch failed";
    testLog.error({ err: errorMsg }, "[TestMetadata] Failed");
    // Even on failure, return the contract shape so the frontend never crashes.
    res.status(500).json({
      error: errorMsg,
      voluumWorkspaces: [],
      trafficSources: [],
      affiliateNetworks: [],
      debug: {},
    });
  }
});

// PATCH /sync/voluum/workspaces/:id/set-active
// Any user with access to the target workspace may switch to it.
router.patch("/sync/voluum/workspaces/:id/set-active", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, id)) === null) return;
  const employee = await getEmployeeFromToken(req);
  if (!employee) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const updated = await setActiveWorkspaceForEmployee(employee.id, id);
  if (!updated) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  req.log.info({ workspaceId: id, employeeId: employee.id }, "Workspace set active");
  res.json(serializeWorkspaceForEmployee(updated, { ...employee, activeWorkspaceId: id }));
});

// GET /sync/voluum/campaigns-synced[?include_archived=true (admin only)]
router.get("/sync/voluum/campaigns-synced", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;
  const includeArchived = await shouldIncludeArchived(req);
  const conditions: any[] = [eq(voluumCampaignsTable.workspaceId, workspaceId)];
  if (!includeArchived) conditions.push(isNull(voluumCampaignsTable.deletedAt));
  const campaigns = await db.select().from(voluumCampaignsTable)
    .where(and(...conditions))
    .orderBy(voluumCampaignsTable.campaignName);
  res.json(campaigns);
});

// GET /sync/voluum/offers[?include_archived=true (admin only)]
router.get("/sync/voluum/offers", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;
  const unmappedOnly = req.query.unmapped_only === "true";
  const includeArchived = await shouldIncludeArchived(req);

  const conditions: any[] = [eq(voluumOffersTable.workspaceId, workspaceId)];
  if (unmappedOnly) conditions.push(sql`${voluumOffersTable.batchId} IS NULL`);
  if (!includeArchived) conditions.push(isNull(voluumOffersTable.deletedAt));

  const offers = await db.select().from(voluumOffersTable)
    .where(and(...conditions))
    .orderBy(voluumOffersTable.offerName)
    .limit(500);
  res.json(offers);
});

// POST /sync/voluum/offers/:id/assign-batch
router.post("/sync/voluum/offers/:id/assign-batch", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { batchId } = req.body;

  // Fetch the offer to determine workspace, then check access
  const [offer] = await db.select({ workspaceId: voluumOffersTable.workspaceId })
    .from(voluumOffersTable).where(eq(voluumOffersTable.id, id));
  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }
  const access = await checkWorkspaceAccess(req, offer.workspaceId);
  if (!access.allowed) {
    res.status(access.status ?? 403).json({ error: access.reason });
    return;
  }

  // If linking to a batch, verify the batch belongs to the same workspace
  // as the offer. Prevents cross-workspace linkage by ID.
  if (batchId) {
    const [batch] = await db
      .select({ workspaceId: testingBatchesTable.workspaceId })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, Number(batchId)));
    if (!batch) {
      res.status(404).json({ error: "Batch not found" });
      return;
    }
    if ((batch.workspaceId ?? null) !== (offer.workspaceId ?? null)) {
      res.status(403).json({ error: "Batch belongs to a different workspace" });
      return;
    }
    if (batch.workspaceId != null) {
      const batchAccess = await checkWorkspaceAccess(req, batch.workspaceId);
      if (!batchAccess.allowed) {
        res.status(batchAccess.status ?? 403).json({ error: batchAccess.reason });
        return;
      }
    }
  }

  await db.update(voluumOffersTable)
    .set({ batchId: batchId ? Number(batchId) : null })
    .where(eq(voluumOffersTable.id, id));
  req.log.info({ offerId: id, batchId }, "Voluum offer assigned to batch");
  res.json({ success: true });
});

// POST /sync/voluum/workspaces/:id/auto-group-offers
router.post("/sync/voluum/workspaces/:id/auto-group-offers", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [ws] = await db.select({ id: workspacesTable.id }).from(workspacesTable).where(eq(workspacesTable.id, id));
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  const access = await checkWorkspaceAccess(req, id);
  if (!access.allowed) {
    res.status(access.status ?? 403).json({ error: access.reason });
    return;
  }
  try {
    const result = await autoGroupOffersIntoBatches(id, req.log);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Auto-group failed" });
  }
});

// GET /sync/voluum/traffic-sources?workspace_id=N[&include_archived=true (admin only)]
router.get("/sync/voluum/traffic-sources", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;
  const includeArchived = await shouldIncludeArchived(req);
  const conditions: any[] = [eq(voluumTrafficSourcesTable.workspaceId, workspaceId)];
  if (!includeArchived) conditions.push(isNull(voluumTrafficSourcesTable.deletedAt));
  const sources = await db.select()
    .from(voluumTrafficSourcesTable)
    .where(and(...conditions))
    .orderBy(voluumTrafficSourcesTable.name);
  res.json(sources);
});

// GET /sync/voluum/affiliate-networks?workspace_id=N[&include_archived=true (admin only)]
router.get("/sync/voluum/affiliate-networks", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;
  const includeArchived = await shouldIncludeArchived(req);
  const conditions: any[] = [eq(voluumAffiliateNetworksTable.workspaceId, workspaceId)];
  if (!includeArchived) conditions.push(isNull(voluumAffiliateNetworksTable.deletedAt));
  const networks = await db.select()
    .from(voluumAffiliateNetworksTable)
    .where(and(...conditions))
    .orderBy(voluumAffiliateNetworksTable.name);
  res.json(networks);
});

export default router;
