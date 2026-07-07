import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  affiliateNetworksTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  geosTable,
  workerAffiliateNetworksTable,
} from "@workspace/db";
import {
  findDuplicateGoal,
  workerGoalRowKey,
  type ServerWorkerGoalTarget,
} from "./goals-config-server.ts";
import { getSettingValue, upsertSetting } from "./settings-store.ts";

export const GOALS_SHEET_NAME = "Goals";
export const GEO_OVERRIDES_SHEET_NAME = "Geo Overrides";

export const GOALS_REQUIRED_HEADERS = [
  "month",
  "employee_email",
  "employee_name",
  "affiliate_network",
  "selected_geos",
  "revenue_target",
  "testing_target",
  "working_target",
] as const;

export const GEO_OVERRIDE_HEADERS = [
  "month",
  "employee_email",
  "affiliate_network",
  "geo",
  "revenue_override",
  "testing_override",
  "working_override",
] as const;

export type GoalMetricKey = "revenue" | "testingBatches" | "workingCampaigns";

export type ImportRowStatus = "valid" | "error" | "warning";

export type NormalizedImportGoal = {
  monthKey: string;
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  affiliateNetworkId: number;
  affiliateNetworkName: string;
  selectedGeoCodes: string[] | null;
  geoId: number | null;
  geoCode: string | null;
  metricKey: GoalMetricKey;
  monthlyTarget: number;
  source: "goals_sheet" | "geo_override_sheet";
  sourceRowNumber: number;
};

export type ImportPreviewRow = {
  rowNumber: number;
  status: ImportRowStatus;
  employeeName: string | null;
  employeeEmail: string | null;
  monthKey: string | null;
  affiliateNetworkName: string | null;
  selectedGeoCodes: string[];
  revenueTarget: number | null;
  testingTarget: number | null;
  workingTarget: number | null;
  messages: string[];
};

export type ImportPreviewSummary = {
  validRows: number;
  errorRows: number;
  warnings: number;
  newGoals: number;
  updatedGoals: number;
  skippedRows: number;
};

export type GoalsImportPreviewResult = {
  ok: boolean;
  summary: ImportPreviewSummary;
  rows: ImportPreviewRow[];
  errors: string[];
  warnings: string[];
  normalizedGoals: NormalizedImportGoal[];
  checksum: string;
};

export type GoalsImportConfirmResult = {
  ok: boolean;
  importMode: "UPSERT_ROWS_ONLY";
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  goalsBeforeCount: number;
  goalsAfterCount: number;
};

type RawSheetRow = Record<string, unknown>;

type WorkspaceImportContext = {
  workspaceId: number;
  employeesByEmail: Map<string, { id: number; name: string; email: string; status: string; role: string }>;
  networksByLowerName: Map<string, { id: number; name: string }>;
  geosByCode: Map<string, { id: number; code: string }>;
  assignments: Set<string>;
  existingGoals: ServerWorkerGoalTarget[];
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function cellString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function parseMonthKey(value: unknown): string | null {
  const s = cellString(value);
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const [y, m] = s.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  return s;
}

function parseNonNegativeNumber(value: unknown, integer = false): number | null {
  if (value == null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return integer ? Math.trunc(n) : n;
}

function parseGeoList(value: unknown): string[] {
  const raw = cellString(value);
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const code = part.trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function assignmentKey(employeeId: number, networkId: number): string {
  return `${employeeId}|${networkId}`;
}

function rowIdentityKey(monthKey: string, email: string, network: string): string {
  return `${monthKey}|${email.trim().toLowerCase()}|${network.trim().toLowerCase()}`;
}

function overrideIdentityKey(monthKey: string, email: string, network: string, geo: string): string {
  return `${monthKey}|${email.trim().toLowerCase()}|${network.trim().toLowerCase()}|${geo.trim().toUpperCase()}`;
}

function resolveNetworkName(input: string, ctx: WorkspaceImportContext): { name: string; id: number } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const exact = ctx.networksByLowerName.get(trimmed.toLowerCase());
  if (exact) return exact;
  return null;
}

function sheetToRows(workbook: XLSX.WorkBook, sheetName: string, requiredHeaders: readonly string[]): RawSheetRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  if (matrix.length === 0) return [];

  const headerRow = (matrix[0] ?? []).map(normalizeHeader);
  const headerIndex = new Map<string, number>();
  headerRow.forEach((h, i) => {
    if (h) headerIndex.set(h, i);
  });

  for (const required of requiredHeaders) {
    if (!headerIndex.has(required)) {
      throw new Error(`Missing required column "${required}" on sheet "${sheetName}"`);
    }
  }

  const rows: RawSheetRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    const obj: RawSheetRow = {};
    let hasValue = false;
    for (const required of requiredHeaders) {
      const idx = headerIndex.get(required)!;
      const val = line[idx] ?? "";
      obj[required] = val;
      if (cellString(val)) hasValue = true;
    }
    if (hasValue) rows.push(obj);
  }
  return rows;
}

export function parseGoalsWorkbook(buffer: Buffer): {
  goalsRows: RawSheetRow[];
  geoOverrideRows: RawSheetRow[];
  hasGeoOverridesSheet: boolean;
} {
  if (!buffer.length) {
    throw new Error("Empty file");
  }
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const goalsRows = sheetToRows(workbook, GOALS_SHEET_NAME, GOALS_REQUIRED_HEADERS);
  const hasGeoOverridesSheet = Boolean(workbook.Sheets[GEO_OVERRIDES_SHEET_NAME]);
  let geoOverrideRows: RawSheetRow[] = [];
  if (hasGeoOverridesSheet) {
    geoOverrideRows = sheetToRows(workbook, GEO_OVERRIDES_SHEET_NAME, GEO_OVERRIDE_HEADERS);
  }
  return { goalsRows, geoOverrideRows, hasGeoOverridesSheet };
}

export async function loadWorkspaceImportContext(workspaceId: number): Promise<WorkspaceImportContext> {
  const assignmentRows = await db
    .select({
      employeeId: employeeWorkspaceAssignmentsTable.employeeId,
      email: employeesTable.email,
      name: employeesTable.name,
      status: employeesTable.status,
      role: employeesTable.role,
    })
    .from(employeeWorkspaceAssignmentsTable)
    .innerJoin(employeesTable, eq(employeeWorkspaceAssignmentsTable.employeeId, employeesTable.id))
    .where(eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId));

  const employeesByEmail = new Map<
    string,
    { id: number; name: string; email: string; status: string; role: string }
  >();
  for (const row of assignmentRows) {
    employeesByEmail.set(row.email.trim().toLowerCase(), {
      id: row.employeeId,
      name: row.name,
      email: row.email,
      status: row.status,
      role: row.role,
    });
  }

  const networkRows = await db
    .select({ id: affiliateNetworksTable.id, name: affiliateNetworksTable.name })
    .from(affiliateNetworksTable)
    .where(eq(affiliateNetworksTable.workspaceId, workspaceId));

  const networksByLowerName = new Map<string, { id: number; name: string }>();
  for (const net of networkRows) {
    networksByLowerName.set(net.name.trim().toLowerCase(), { id: net.id, name: net.name });
  }

  const geoRows = await db
    .select({ id: geosTable.id, code: geosTable.code })
    .from(geosTable)
    .where(eq(geosTable.workspaceId, workspaceId));

  const geosByCode = new Map<string, { id: number; code: string }>();
  for (const geo of geoRows) {
    geosByCode.set(geo.code.trim().toUpperCase(), { id: geo.id, code: geo.code });
  }

  const workerNetRows = await db
    .select({
      employeeId: workerAffiliateNetworksTable.employeeId,
      networkId: workerAffiliateNetworksTable.affiliateNetworkId,
    })
    .from(workerAffiliateNetworksTable)
    .where(eq(workerAffiliateNetworksTable.workspaceId, workspaceId));

  const assignments = new Set<string>();
  for (const row of workerNetRows) {
    assignments.add(assignmentKey(row.employeeId, row.networkId));
  }

  const raw = await getSettingValue(workspaceId, "goals_config");
  let existingGoals: ServerWorkerGoalTarget[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { workerGoalTargets?: ServerWorkerGoalTarget[] };
      existingGoals = Array.isArray(parsed.workerGoalTargets) ? parsed.workerGoalTargets : [];
    } catch {
      existingGoals = [];
    }
  }

  return {
    workspaceId,
    employeesByEmail,
    networksByLowerName,
    geosByCode,
    assignments,
    existingGoals,
  };
}

function existingGoalForNormalized(
  goals: ServerWorkerGoalTarget[],
  goal: NormalizedImportGoal,
): ServerWorkerGoalTarget | undefined {
  const candidate: ServerWorkerGoalTarget = {
    id: "preview",
    employeeId: goal.employeeId,
    metricKey: goal.metricKey,
    affiliateNetworkName: goal.affiliateNetworkName,
    geoCode: goal.geoCode,
    monthKey: goal.monthKey,
    monthlyTarget: goal.monthlyTarget,
    isActive: true,
  };
  return findDuplicateGoal(goals, candidate);
}

export function computeImportChecksum(goals: NormalizedImportGoal[]): string {
  const stable = [...goals]
    .sort((a, b) => {
      const ak = `${a.monthKey}|${a.employeeId}|${a.affiliateNetworkName}|${a.metricKey}|${a.geoCode ?? ""}`;
      const bk = `${b.monthKey}|${b.employeeId}|${b.affiliateNetworkName}|${b.metricKey}|${b.geoCode ?? ""}`;
      return ak.localeCompare(bk);
    })
    .map((g) => ({
      monthKey: g.monthKey,
      employeeId: g.employeeId,
      affiliateNetworkName: g.affiliateNetworkName,
      selectedGeoCodes: g.selectedGeoCodes,
      geoCode: g.geoCode,
      metricKey: g.metricKey,
      monthlyTarget: g.monthlyTarget,
    }));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function validateGoalsImport(
  ctx: WorkspaceImportContext,
  goalsRows: RawSheetRow[],
  geoOverrideRows: RawSheetRow[],
): GoalsImportPreviewResult {
  const rows: ImportPreviewRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalizedGoals: NormalizedImportGoal[] = [];
  const seenGoalRows = new Map<string, ImportPreviewRow>();
  const seenOverrideRows = new Set<string>();

  let validRows = 0;
  let errorRows = 0;
  let warningRows = 0;
  let skippedRows = 0;

  for (let i = 0; i < goalsRows.length; i++) {
    const raw = goalsRows[i]!;
    const rowNumber = i + 2;
    const messages: string[] = [];
    const email = cellString(raw.employee_email).toLowerCase();
    const monthKey = parseMonthKey(raw.month);
    const networkInput = cellString(raw.affiliate_network);
    const selectedGeoCodes = parseGeoList(raw.selected_geos);
    const revenueTarget = parseNonNegativeNumber(raw.revenue_target, false);
    const testingTarget = parseNonNegativeNumber(raw.testing_target, true);
    const workingTarget = parseNonNegativeNumber(raw.working_target, true);

    const previewRow: ImportPreviewRow = {
      rowNumber,
      status: "valid",
      employeeName: cellString(raw.employee_name) || null,
      employeeEmail: email || null,
      monthKey,
      affiliateNetworkName: networkInput || null,
      selectedGeoCodes,
      revenueTarget,
      testingTarget,
      workingTarget,
      messages,
    };

    if (!monthKey) messages.push("Invalid or missing month (expected YYYY-MM).");
    if (!email) messages.push("employee_email is required.");
    if (!networkInput) messages.push("affiliate_network is required.");
    if (selectedGeoCodes.length === 0) messages.push("selected_geos is required (comma-separated GEO codes).");
    if (revenueTarget == null) messages.push("revenue_target must be a non-negative number.");
    if (testingTarget == null) messages.push("testing_target must be a non-negative integer.");
    if (workingTarget == null) messages.push("working_target must be a non-negative integer.");

    const employee = email ? ctx.employeesByEmail.get(email) : undefined;
    if (email && !employee) messages.push(`Unknown employee_email "${email}" in workspace.`);
    if (employee && employee.status !== "active") messages.push(`Employee "${email}" is inactive.`);

    const network = networkInput ? resolveNetworkName(networkInput, ctx) : null;
    if (networkInput && !network) messages.push(`Unknown affiliate_network "${networkInput}".`);
    if (employee && network && !ctx.assignments.has(assignmentKey(employee.id, network.id))) {
      messages.push(`Network "${network.name}" is not assigned to employee "${email}".`);
    }

    for (const code of selectedGeoCodes) {
      if (!ctx.geosByCode.has(code)) messages.push(`Unknown GEO code "${code}".`);
    }

    if (monthKey && email && networkInput) {
      const dupKey = rowIdentityKey(monthKey, email, networkInput);
      const prior = seenGoalRows.get(dupKey);
      if (prior) {
        const same =
          prior.revenueTarget === revenueTarget &&
          prior.testingTarget === testingTarget &&
          prior.workingTarget === workingTarget &&
          prior.selectedGeoCodes.join(",") === selectedGeoCodes.join(",");
        if (!same) {
          messages.push("Duplicate row for month + employee_email + affiliate_network.");
        } else {
          previewRow.status = "warning";
          previewRow.messages.push("Exact duplicate row ignored.");
          warningRows += 1;
          skippedRows += 1;
          rows.push(previewRow);
          warnings.push(`Row ${rowNumber}: exact duplicate ignored.`);
          continue;
        }
      } else {
        seenGoalRows.set(dupKey, previewRow);
      }
    }

    const allTargetsZero =
      (revenueTarget ?? 0) === 0 && (testingTarget ?? 0) === 0 && (workingTarget ?? 0) === 0;

    if (messages.length > 0) {
      previewRow.status = "error";
      errorRows += 1;
      rows.push(previewRow);
      errors.push(`Row ${rowNumber}: ${messages.join(" ")}`);
      continue;
    }

    if (allTargetsZero) {
      previewRow.status = "warning";
      previewRow.messages.push("All targets are zero — row skipped.");
      warningRows += 1;
      skippedRows += 1;
      rows.push(previewRow);
      warnings.push(`Row ${rowNumber}: all targets are zero — skipped.`);
      continue;
    }

    previewRow.status = "valid";
    previewRow.affiliateNetworkName = network!.name;
    previewRow.employeeName = employee!.name;
    validRows += 1;
    rows.push(previewRow);

    const metricTargets: { metricKey: GoalMetricKey; value: number }[] = [
      { metricKey: "revenue", value: revenueTarget ?? 0 },
      { metricKey: "testingBatches", value: testingTarget ?? 0 },
      { metricKey: "workingCampaigns", value: workingTarget ?? 0 },
    ];

    for (const metric of metricTargets) {
      normalizedGoals.push({
        monthKey: monthKey!,
        employeeId: employee!.id,
        employeeName: employee!.name,
        employeeEmail: employee!.email,
        affiliateNetworkId: network!.id,
        affiliateNetworkName: network!.name,
        selectedGeoCodes,
        geoId: null,
        geoCode: null,
        metricKey: metric.metricKey,
        monthlyTarget: metric.value,
        source: "goals_sheet",
        sourceRowNumber: rowNumber,
      });
    }
  }

  for (let i = 0; i < geoOverrideRows.length; i++) {
    const raw = geoOverrideRows[i]!;
    const rowNumber = i + 2;
    const messages: string[] = [];
    const email = cellString(raw.employee_email).toLowerCase();
    const monthKey = parseMonthKey(raw.month);
    const networkInput = cellString(raw.affiliate_network);
    const geoCode = cellString(raw.geo).toUpperCase();
    const revenueOverride = parseNonNegativeNumber(raw.revenue_override, false);
    const testingOverride = parseNonNegativeNumber(raw.testing_override, true);
    const workingOverride = parseNonNegativeNumber(raw.working_override, true);

    if (!monthKey) messages.push("Invalid or missing month (expected YYYY-MM).");
    if (!email) messages.push("employee_email is required.");
    if (!networkInput) messages.push("affiliate_network is required.");
    if (!geoCode) messages.push("geo is required.");
    if (revenueOverride == null) messages.push("revenue_override must be a non-negative number.");
    if (testingOverride == null) messages.push("testing_override must be a non-negative integer.");
    if (workingOverride == null) messages.push("working_override must be a non-negative integer.");

    const employee = email ? ctx.employeesByEmail.get(email) : undefined;
    if (email && !employee) messages.push(`Unknown employee_email "${email}" in workspace.`);
    if (employee && employee.status !== "active") messages.push(`Employee "${email}" is inactive.`);

    const network = networkInput ? resolveNetworkName(networkInput, ctx) : null;
    if (networkInput && !network) messages.push(`Unknown affiliate_network "${networkInput}".`);
    if (employee && network && !ctx.assignments.has(assignmentKey(employee.id, network.id))) {
      messages.push(`Network "${network.name}" is not assigned to employee "${email}".`);
    }
    if (geoCode && !ctx.geosByCode.has(geoCode)) messages.push(`Unknown GEO code "${geoCode}".`);

    if (monthKey && email && networkInput && geoCode) {
      const dupKey = overrideIdentityKey(monthKey, email, networkInput, geoCode);
      if (seenOverrideRows.has(dupKey)) messages.push("Duplicate override row.");
      else seenOverrideRows.add(dupKey);
    }

    const allOverridesBlank =
      (revenueOverride ?? 0) === 0 &&
      (testingOverride ?? 0) === 0 &&
      (workingOverride ?? 0) === 0 &&
      raw.revenue_override == null &&
      raw.testing_override == null &&
      raw.working_override == null;

    if (messages.length > 0) {
      errorRows += 1;
      errors.push(`Geo Overrides row ${rowNumber}: ${messages.join(" ")}`);
      continue;
    }

    if (allOverridesBlank) {
      warnings.push(`Geo Overrides row ${rowNumber}: all overrides blank — skipped.`);
      skippedRows += 1;
      continue;
    }

    const geo = ctx.geosByCode.get(geoCode)!;
    const overrideMetrics: { metricKey: GoalMetricKey; value: number | null; raw: unknown }[] = [
      { metricKey: "revenue", value: revenueOverride, raw: raw.revenue_override },
      { metricKey: "testingBatches", value: testingOverride, raw: raw.testing_override },
      { metricKey: "workingCampaigns", value: workingOverride, raw: raw.working_override },
    ];

    for (const metric of overrideMetrics) {
      if (metric.raw == null || metric.raw === "") continue;
      normalizedGoals.push({
        monthKey: monthKey!,
        employeeId: employee!.id,
        employeeName: employee!.name,
        employeeEmail: employee!.email,
        affiliateNetworkId: network!.id,
        affiliateNetworkName: network!.name,
        selectedGeoCodes: null,
        geoId: geo.id,
        geoCode: geo.code,
        metricKey: metric.metricKey,
        monthlyTarget: metric.value ?? 0,
        source: "geo_override_sheet",
        sourceRowNumber: rowNumber,
      });
    }
  }

  let newGoals = 0;
  let updatedGoals = 0;
  for (const goal of normalizedGoals) {
    const existing = existingGoalForNormalized(ctx.existingGoals, goal);
    if (existing) updatedGoals += 1;
    else newGoals += 1;
  }

  const checksum = computeImportChecksum(normalizedGoals);

  return {
    ok: errorRows === 0,
    summary: {
      validRows,
      errorRows,
      warnings: warningRows + warnings.length,
      newGoals,
      updatedGoals,
      skippedRows,
    },
    rows,
    errors,
    warnings,
    normalizedGoals,
    checksum,
  };
}

export async function previewGoalsExcelImport(
  workspaceId: number,
  fileBuffer: Buffer,
): Promise<GoalsImportPreviewResult> {
  const { goalsRows, geoOverrideRows } = parseGoalsWorkbook(fileBuffer);
  const ctx = await loadWorkspaceImportContext(workspaceId);
  return validateGoalsImport(ctx, goalsRows, geoOverrideRows);
}

export function upsertNormalizedGoals(
  existingGoals: ServerWorkerGoalTarget[],
  normalizedGoals: NormalizedImportGoal[],
): { nextGoals: ServerWorkerGoalTarget[]; createdCount: number; updatedCount: number } {
  const nextGoals = [...existingGoals];
  let createdCount = 0;
  let updatedCount = 0;
  const now = new Date().toISOString();
  const ts = Date.now();

  for (const goal of normalizedGoals) {
    const candidate: ServerWorkerGoalTarget = {
      id: `preview_${goal.metricKey}`,
      employeeId: goal.employeeId,
      employeeName: goal.employeeName,
      affiliateNetworkId: goal.affiliateNetworkId,
      affiliateNetworkName: goal.affiliateNetworkName,
      geoId: goal.geoId,
      geoCode: goal.geoCode,
      selectedGeoCodes: goal.selectedGeoCodes,
      metricKey: goal.metricKey,
      monthlyTarget: goal.monthlyTarget,
      monthKey: goal.monthKey,
      isActive: true,
      xpReward: 0,
    };

    const dup = findDuplicateGoal(nextGoals, candidate);
    if (dup) {
      const idx = nextGoals.findIndex((g) => g.id === dup.id);
      const preservedXp = dup.xpReward ?? 0;
      nextGoals[idx] = {
        ...dup,
        employeeName: goal.employeeName,
        affiliateNetworkId: goal.affiliateNetworkId,
        affiliateNetworkName: goal.affiliateNetworkName,
        geoId: goal.geoId,
        geoCode: goal.geoCode,
        selectedGeoCodes: goal.selectedGeoCodes,
        monthlyTarget: goal.monthlyTarget,
        monthKey: goal.monthKey,
        isActive: true,
        updatedAt: now,
        xpReward: preservedXp,
      };
      updatedCount += 1;
    } else {
      nextGoals.push({
        ...candidate,
        id: `wg_${goal.metricKey}_${goal.employeeId}_${goal.monthKey}_${goal.affiliateNetworkName}_${goal.geoCode ?? "net"}_${ts}_${createdCount}`,
        createdAt: now,
        updatedAt: now,
        xpReward: goal.geoCode ? 0 : defaultXpForMetric(goal.metricKey),
      });
      createdCount += 1;
    }
  }

  return { nextGoals, createdCount, updatedCount };
}

function defaultXpForMetric(metricKey: GoalMetricKey): number {
  if (metricKey === "revenue") return 500;
  if (metricKey === "testingBatches") return 200;
  return 300;
}

export function revalidateNormalizedGoals(
  ctx: WorkspaceImportContext,
  normalizedGoals: NormalizedImportGoal[],
): GoalsImportPreviewResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const goal of normalizedGoals) {
    const employee = ctx.employeesByEmail.get(goal.employeeEmail.trim().toLowerCase());
    if (!employee || employee.id !== goal.employeeId) {
      errors.push(`Invalid employee for goal ${goal.metricKey} / ${goal.affiliateNetworkName}.`);
      continue;
    }
    if (employee.status !== "active") {
      errors.push(`Employee ${goal.employeeEmail} is inactive.`);
    }
    const network = resolveNetworkName(goal.affiliateNetworkName, ctx);
    if (!network || network.id !== goal.affiliateNetworkId) {
      errors.push(`Invalid affiliate network "${goal.affiliateNetworkName}".`);
    } else if (!ctx.assignments.has(assignmentKey(goal.employeeId, network.id))) {
      errors.push(`Network "${goal.affiliateNetworkName}" is not assigned to ${goal.employeeEmail}.`);
    }
    if (goal.geoCode) {
      const geo = ctx.geosByCode.get(goal.geoCode.trim().toUpperCase());
      if (!geo || geo.id !== goal.geoId) {
        errors.push(`Invalid GEO "${goal.geoCode}" for override goal.`);
      }
    }
    if (goal.selectedGeoCodes) {
      for (const code of goal.selectedGeoCodes) {
        if (!ctx.geosByCode.has(code.trim().toUpperCase())) {
          errors.push(`Unknown GEO code "${code}" in selected_geos.`);
        }
      }
    }
    if (!/^\d{4}-\d{2}$/.test(goal.monthKey)) {
      errors.push(`Invalid monthKey "${goal.monthKey}".`);
    }
    if (goal.monthlyTarget < 0 || !Number.isFinite(goal.monthlyTarget)) {
      errors.push(`Invalid target for ${goal.metricKey}.`);
    }
  }

  let newGoals = 0;
  let updatedGoals = 0;
  for (const goal of normalizedGoals) {
    const existing = existingGoalForNormalized(ctx.existingGoals, goal);
    if (existing) updatedGoals += 1;
    else newGoals += 1;
  }

  const checksum = computeImportChecksum(normalizedGoals);

  return {
    ok: errors.length === 0,
    summary: {
      validRows: normalizedGoals.length,
      errorRows: errors.length,
      warnings: warnings.length,
      newGoals,
      updatedGoals,
      skippedRows: 0,
    },
    rows: [],
    errors,
    warnings,
    normalizedGoals,
    checksum,
  };
}

export async function confirmGoalsExcelImport(params: {
  workspaceId: number;
  adminId: number;
  importMode: "UPSERT_ROWS_ONLY";
  normalizedGoals: NormalizedImportGoal[];
  checksum: string;
}): Promise<GoalsImportConfirmResult> {
  const { workspaceId, adminId, importMode, normalizedGoals, checksum } = params;

  const recomputed = computeImportChecksum(normalizedGoals);
  if (recomputed !== checksum) {
    throw new Error("Import checksum mismatch — please preview again.");
  }

  const ctx = await loadWorkspaceImportContext(workspaceId);
  const revalidated = revalidateNormalizedGoals(ctx, normalizedGoals);
  if (!revalidated.ok) {
    throw new Error(revalidated.errors[0] ?? "Import validation failed.");
  }

  const raw = await getSettingValue(workspaceId, "goals_config");
  let cfg: Record<string, unknown> = {};
  try {
    cfg = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    cfg = {};
  }

  const existingGoals = Array.isArray(cfg.workerGoalTargets)
    ? (cfg.workerGoalTargets as ServerWorkerGoalTarget[])
    : [];
  const goalsBeforeCount = existingGoals.length;

  const unrelatedBefore = existingGoals.filter((g) => {
    return !normalizedGoals.some((ng) => {
      const candidate: ServerWorkerGoalTarget = {
        id: "x",
        employeeId: ng.employeeId,
        metricKey: ng.metricKey,
        affiliateNetworkName: ng.affiliateNetworkName,
        geoCode: ng.geoCode,
        monthKey: ng.monthKey,
        monthlyTarget: ng.monthlyTarget,
        isActive: true,
      };
      return workerGoalRowKey(g) === workerGoalRowKey(candidate);
    });
  });

  const { nextGoals, createdCount, updatedCount } = upsertNormalizedGoals(existingGoals, normalizedGoals);

  const unrelatedAfter = nextGoals.filter((g) => {
    return !normalizedGoals.some((ng) => {
      const candidate: ServerWorkerGoalTarget = {
        id: "x",
        employeeId: ng.employeeId,
        metricKey: ng.metricKey,
        affiliateNetworkName: ng.affiliateNetworkName,
        geoCode: ng.geoCode,
        monthKey: ng.monthKey,
        monthlyTarget: ng.monthlyTarget,
        isActive: true,
      };
      return workerGoalRowKey(g) === workerGoalRowKey(candidate);
    });
  });

  if (unrelatedAfter.length !== unrelatedBefore.length) {
    throw new Error("Import would modify unrelated worker goals — aborted.");
  }

  cfg.workerGoalTargets = nextGoals;
  await upsertSetting(workspaceId, "goals_config", JSON.stringify(cfg));

  const auditEntry = {
    route: "/performance/monthly-goals/import/confirm",
    adminId,
    importMode,
    rowsCount: normalizedGoals.length,
    goalsBeforeCount,
    goalsAfterCount: nextGoals.length,
    createdCount,
    updatedCount,
    skippedCount: 0,
    errorsCount: 0,
    timestamp: new Date().toISOString(),
  };

  const existingAudit = await getSettingValue(workspaceId, "goals_audit_log");
  let auditLog: unknown[] = [];
  if (existingAudit) {
    try {
      auditLog = JSON.parse(existingAudit) as unknown[];
    } catch {
      auditLog = [];
    }
  }
  auditLog.unshift(auditEntry);
  await upsertSetting(workspaceId, "goals_audit_log", JSON.stringify(auditLog.slice(0, 50)));

  return {
    ok: true,
    importMode,
    createdCount,
    updatedCount,
    skippedCount: 0,
    goalsBeforeCount,
    goalsAfterCount: nextGoals.length,
  };
}
