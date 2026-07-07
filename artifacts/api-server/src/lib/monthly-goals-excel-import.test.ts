import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { and, eq, inArray } from "drizzle-orm";
import {
  affiliateNetworksTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  geosTable,
  settingsTable,
  workerAffiliateNetworksTable,
  workspacesTable,
} from "@workspace/db";
import {
  GOALS_REQUIRED_HEADERS,
  GOALS_OPTIONAL_HEADERS,
  GOALS_TEMPLATE_HEADERS,
  GEO_OVERRIDE_HEADERS,
  GOALS_SHEET_NAME,
  GEO_OVERRIDES_SHEET_NAME,
  parseGoalsWorkbook,
  validateGoalsImport,
  upsertNormalizedGoals,
  confirmGoalsExcelImport,
  buildGoalsImportTemplateBuffer,
  type NormalizedImportGoal,
} from "./monthly-goals-excel-import.ts";
import { loadWorkspaceImportContext } from "./monthly-goals-excel-import.ts";
import type { ServerWorkerGoalTarget } from "./goals-config-server.ts";

const createdWorkspaceIds: number[] = [];
const createdEmployeeIds: number[] = [];

function buildWorkbook(
  goalsRows: Record<string, string | number>[],
  geoOverrideRows: Record<string, string | number>[] = [],
  includeXpHeaders = false,
): Buffer {
  const headers = includeXpHeaders ? [...GOALS_TEMPLATE_HEADERS] : [...GOALS_REQUIRED_HEADERS];
  const wb = XLSX.utils.book_new();
  const goalsData = [
    headers,
    ...goalsRows.map((row) => headers.map((h) => row[h] ?? "")),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(goalsData), GOALS_SHEET_NAME);
  if (geoOverrideRows.length > 0) {
    const overrideData = [
      GEO_OVERRIDE_HEADERS,
      ...geoOverrideRows.map((row) => GEO_OVERRIDE_HEADERS.map((h) => row[h] ?? "")),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overrideData), GEO_OVERRIDES_SHEET_NAME);
  }
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

async function seedWorkspace() {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `Goals Import ${Date.now()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws.id);

  const saraId = (
    await db
      .insert(employeesTable)
      .values({
        name: "Sara",
        email: `sara-${Date.now()}@example.com`,
        passwordHash: "x",
        role: "employee",
        status: "active",
      })
      .returning({ id: employeesTable.id })
  )[0]!.id;
  const kidaId = (
    await db
      .insert(employeesTable)
      .values({
        name: "Kida",
        email: `kida-${Date.now()}@example.com`,
        passwordHash: "x",
        role: "employee",
        status: "active",
      })
      .returning({ id: employeesTable.id })
  )[0]!.id;
  createdEmployeeIds.push(saraId, kidaId);

  for (const employeeId of [saraId, kidaId]) {
    await db.insert(employeeWorkspaceAssignmentsTable).values({
      employeeId,
      workspaceId: ws.id,
      role: "employee",
    }).onConflictDoNothing();
  }

  const netA = (
    await db
      .insert(affiliateNetworksTable)
      .values({ workspaceId: ws.id, name: "Yieldkit CBV" })
      .returning({ id: affiliateNetworksTable.id })
  )[0]!.id;
  const netB = (
    await db
      .insert(affiliateNetworksTable)
      .values({ workspaceId: ws.id, name: "Shoplooks PAP" })
      .returning({ id: affiliateNetworksTable.id })
  )[0]!.id;

  await db.insert(workerAffiliateNetworksTable).values([
    { workspaceId: ws.id, employeeId: saraId, affiliateNetworkId: netA },
    { workspaceId: ws.id, employeeId: kidaId, affiliateNetworkId: netB },
  ]);

  await db.insert(geosTable).values([
    { workspaceId: ws.id, code: "GB", name: "United Kingdom" },
    { workspaceId: ws.id, code: "DE", name: "Germany" },
    { workspaceId: ws.id, code: "US", name: "United States" },
  ]);

  const saraEmail = (await db.select({ email: employeesTable.email }).from(employeesTable).where(eq(employeesTable.id, saraId)))[0]!.email;
  const kidaEmail = (await db.select({ email: employeesTable.email }).from(employeesTable).where(eq(employeesTable.id, kidaId)))[0]!.email;

  return { workspaceId: ws.id, saraId, kidaId, saraEmail, kidaEmail, netA, netB };
}

async function setGoalsConfig(workspaceId: number, workerGoalTargets: ServerWorkerGoalTarget[]) {
  await db
    .insert(settingsTable)
    .values({
      workspaceId,
      key: "goals_config",
      value: JSON.stringify({
        workerGoalTargets,
        pointActions: [],
        eventPointRules: [],
        kpiTargets: [],
      }),
    })
    .onConflictDoUpdate({
      target: [settingsTable.workspaceId, settingsTable.key],
      set: {
        value: JSON.stringify({
          workerGoalTargets,
          pointActions: [],
          eventPointRules: [],
          kpiTargets: [],
        }),
      },
    });
}

describe("monthly goals excel import", () => {
  after(async () => {
    if (createdWorkspaceIds.length) {
      await db.delete(settingsTable).where(inArray(settingsTable.workspaceId, createdWorkspaceIds));
      await db.delete(workerAffiliateNetworksTable).where(inArray(workerAffiliateNetworksTable.workspaceId, createdWorkspaceIds));
      await db.delete(geosTable).where(inArray(geosTable.workspaceId, createdWorkspaceIds));
      await db.delete(affiliateNetworksTable).where(inArray(affiliateNetworksTable.workspaceId, createdWorkspaceIds));
      await db.delete(employeeWorkspaceAssignmentsTable).where(inArray(employeeWorkspaceAssignmentsTable.workspaceId, createdWorkspaceIds));
      await db.delete(workspacesTable).where(inArray(workspacesTable.id, createdWorkspaceIds));
    }
    if (createdEmployeeIds.length) {
      await db.delete(employeesTable).where(inArray(employeesTable.id, createdEmployeeIds));
    }
  });

  it("valid Goals sheet creates normalized revenue/testing/working goals", async () => {
    const seed = await seedWorkspace();
    const buffer = buildWorkbook([
      {
        month: "2026-07",
        employee_email: seed.saraEmail,
        employee_name: "Sara",
        affiliate_network: "Yieldkit CBV",
        selected_geos: "GB,DE",
        revenue_target: 3000,
        testing_target: 12,
        working_target: 4,
      },
    ]);
    const { goalsRows } = parseGoalsWorkbook(buffer);
    const ctx = await loadWorkspaceImportContext(seed.workspaceId);
    const preview = validateGoalsImport(ctx, goalsRows, []);

    assert.equal(preview.ok, true);
    assert.equal(preview.summary.validRows, 1);
    assert.equal(preview.normalizedGoals.length, 3);
    assert.deepEqual(
      preview.normalizedGoals.map((g) => g.metricKey).sort(),
      ["revenue", "testingBatches", "workingCampaigns"],
    );
    assert.equal(preview.normalizedGoals.find((g) => g.metricKey === "revenue")?.monthlyTarget, 3000);
  });

  it("unknown employee_email is a row error", async () => {
    const seed = await seedWorkspace();
    const buffer = buildWorkbook([
      {
        month: "2026-07",
        employee_email: "nobody@example.com",
        employee_name: "Nobody",
        affiliate_network: "Yieldkit CBV",
        selected_geos: "GB",
        revenue_target: 100,
        testing_target: 1,
        working_target: 1,
      },
    ]);
    const { goalsRows } = parseGoalsWorkbook(buffer);
    const ctx = await loadWorkspaceImportContext(seed.workspaceId);
    const preview = validateGoalsImport(ctx, goalsRows, []);
    assert.equal(preview.ok, false);
    assert.equal(preview.summary.errorRows, 1);
  });

  it("network not assigned to employee is a row error", async () => {
    const seed = await seedWorkspace();
    const buffer = buildWorkbook([
      {
        month: "2026-07",
        employee_email: seed.saraEmail,
        employee_name: "Sara",
        affiliate_network: "Shoplooks PAP",
        selected_geos: "GB",
        revenue_target: 100,
        testing_target: 1,
        working_target: 1,
      },
    ]);
    const { goalsRows } = parseGoalsWorkbook(buffer);
    const ctx = await loadWorkspaceImportContext(seed.workspaceId);
    const preview = validateGoalsImport(ctx, goalsRows, []);
    assert.equal(preview.ok, false);
    assert.match(preview.errors[0] ?? "", /not assigned/i);
  });

  it("invalid GEO is a row error", async () => {
    const seed = await seedWorkspace();
    const buffer = buildWorkbook([
      {
        month: "2026-07",
        employee_email: seed.saraEmail,
        employee_name: "Sara",
        affiliate_network: "Yieldkit CBV",
        selected_geos: "ZZ",
        revenue_target: 100,
        testing_target: 1,
        working_target: 1,
      },
    ]);
    const { goalsRows } = parseGoalsWorkbook(buffer);
    const ctx = await loadWorkspaceImportContext(seed.workspaceId);
    const preview = validateGoalsImport(ctx, goalsRows, []);
    assert.equal(preview.ok, false);
    assert.match(preview.errors[0] ?? "", /Unknown GEO/i);
  });

  it("duplicate conflicting row is a row error", async () => {
    const seed = await seedWorkspace();
    const buffer = buildWorkbook([
      {
        month: "2026-07",
        employee_email: seed.saraEmail,
        employee_name: "Sara",
        affiliate_network: "Yieldkit CBV",
        selected_geos: "GB",
        revenue_target: 100,
        testing_target: 1,
        working_target: 1,
      },
      {
        month: "2026-07",
        employee_email: seed.saraEmail,
        employee_name: "Sara",
        affiliate_network: "Yieldkit CBV",
        selected_geos: "GB",
        revenue_target: 200,
        testing_target: 2,
        working_target: 2,
      },
    ]);
    const { goalsRows } = parseGoalsWorkbook(buffer);
    const ctx = await loadWorkspaceImportContext(seed.workspaceId);
    const preview = validateGoalsImport(ctx, goalsRows, []);
    assert.equal(preview.ok, false);
    assert.match(preview.errors.join(" "), /Duplicate row/i);
  });

  it("all-zero target row is warning and skipped", async () => {
    const seed = await seedWorkspace();
    const buffer = buildWorkbook([
      {
        month: "2026-07",
        employee_email: seed.saraEmail,
        employee_name: "Sara",
        affiliate_network: "Yieldkit CBV",
        selected_geos: "GB",
        revenue_target: 0,
        testing_target: 0,
        working_target: 0,
      },
    ]);
    const { goalsRows } = parseGoalsWorkbook(buffer);
    const ctx = await loadWorkspaceImportContext(seed.workspaceId);
    const preview = validateGoalsImport(ctx, goalsRows, []);
    assert.equal(preview.ok, true);
    assert.equal(preview.summary.skippedRows, 1);
    assert.equal(preview.normalizedGoals.length, 0);
  });

  it("upsert preserves unrelated worker goals", async () => {
    const seed = await seedWorkspace();
    const existing: ServerWorkerGoalTarget[] = [
      {
        id: "wg_kida_rev",
        employeeId: seed.kidaId,
        employeeName: "Kida",
        metricKey: "revenue",
        affiliateNetworkName: "Shoplooks PAP",
        monthKey: "2026-07",
        monthlyTarget: 2500,
        isActive: true,
        selectedGeoCodes: ["US"],
      },
    ];
    const incoming: NormalizedImportGoal[] = [
      {
        monthKey: "2026-07",
        employeeId: seed.saraId,
        employeeName: "Sara",
        employeeEmail: seed.saraEmail,
        affiliateNetworkId: seed.netA,
        affiliateNetworkName: "Yieldkit CBV",
        selectedGeoCodes: ["GB"],
        geoId: null,
        geoCode: null,
        metricKey: "revenue",
        monthlyTarget: 3000,
        xpReward: null,
        xpProvided: false,
        source: "goals_sheet",
        sourceRowNumber: 2,
      },
    ];
    const { nextGoals } = upsertNormalizedGoals(existing, incoming);
    assert.equal(nextGoals.length, 2);
    assert.ok(nextGoals.some((g) => g.id === "wg_kida_rev"));
    assert.ok(nextGoals.some((g) => g.employeeId === seed.saraId && g.monthlyTarget === 3000));
  });

  it("upsert updates existing Sara revenue goal instead of duplicating", async () => {
    const seed = await seedWorkspace();
    const existing: ServerWorkerGoalTarget[] = [
      {
        id: "wg_sara_rev",
        employeeId: seed.saraId,
        employeeName: "Sara",
        metricKey: "revenue",
        affiliateNetworkName: "Yieldkit CBV",
        monthKey: "2026-07",
        monthlyTarget: 1000,
        isActive: true,
        selectedGeoCodes: ["GB"],
      },
    ];
    const incoming: NormalizedImportGoal[] = [
      {
        monthKey: "2026-07",
        employeeId: seed.saraId,
        employeeName: "Sara",
        employeeEmail: seed.saraEmail,
        affiliateNetworkId: seed.netA,
        affiliateNetworkName: "Yieldkit CBV",
        selectedGeoCodes: ["GB", "DE"],
        geoId: null,
        geoCode: null,
        metricKey: "revenue",
        monthlyTarget: 3000,
        xpReward: null,
        xpProvided: false,
        source: "goals_sheet",
        sourceRowNumber: 2,
      },
    ];
    const { nextGoals, createdCount, updatedCount } = upsertNormalizedGoals(existing, incoming);
    assert.equal(nextGoals.length, 1);
    assert.equal(createdCount, 0);
    assert.equal(updatedCount, 1);
    assert.equal(nextGoals[0]!.id, "wg_sara_rev");
    assert.equal(nextGoals[0]!.monthlyTarget, 3000);
  });

  it("confirm import does not wipe unrelated workerGoalTargets", async () => {
    const seed = await seedWorkspace();
    const kidaGoal: ServerWorkerGoalTarget = {
      id: "wg_kida_rev",
      employeeId: seed.kidaId,
      employeeName: "Kida",
      metricKey: "revenue",
      affiliateNetworkName: "Shoplooks PAP",
      monthKey: "2026-07",
      monthlyTarget: 2500,
      isActive: true,
      selectedGeoCodes: ["US"],
      affiliateNetworkId: seed.netB,
    };
    await setGoalsConfig(seed.workspaceId, [kidaGoal]);

    const normalizedGoals: NormalizedImportGoal[] = [
      {
        monthKey: "2026-07",
        employeeId: seed.saraId,
        employeeName: "Sara",
        employeeEmail: seed.saraEmail,
        affiliateNetworkId: seed.netA,
        affiliateNetworkName: "Yieldkit CBV",
        selectedGeoCodes: ["GB"],
        geoId: null,
        geoCode: null,
        metricKey: "revenue",
        monthlyTarget: 3000,
        xpReward: null,
        xpProvided: false,
        source: "goals_sheet",
        sourceRowNumber: 2,
      },
    ];

    const { computeImportChecksum } = await import("./monthly-goals-excel-import.ts");
    const checksum = computeImportChecksum(normalizedGoals);

    const result = await confirmGoalsExcelImport({
      workspaceId: seed.workspaceId,
      adminId: seed.saraId,
      importMode: "UPSERT_ROWS_ONLY",
      normalizedGoals,
      checksum,
    });

    assert.equal(result.ok, true);
    assert.equal(result.goalsAfterCount, 2);

    const raw = (
      await db
        .select({ value: settingsTable.value })
        .from(settingsTable)
        .where(and(eq(settingsTable.workspaceId, seed.workspaceId), eq(settingsTable.key, "goals_config")))
    )[0]?.value;
    const cfg = JSON.parse(raw ?? "{}") as { workerGoalTargets: ServerWorkerGoalTarget[] };
    assert.equal(cfg.workerGoalTargets.length, 2);
    assert.ok(cfg.workerGoalTargets.some((g) => g.id === "wg_kida_rev"));
    assert.ok(cfg.workerGoalTargets.some((g) => g.employeeId === seed.saraId && g.monthlyTarget === 3000));
  });

  it("parses XP columns into normalized goals with xpReward values", async () => {
    const seed = await seedWorkspace();
    const buffer = buildWorkbook(
      [
        {
          month: "2026-07",
          employee_email: seed.saraEmail,
          employee_name: "Sara",
          affiliate_network: "Yieldkit CBV",
          selected_geos: "GB,DE",
          revenue_target: 1000,
          revenue_xp: 500,
          testing_target: 4,
          testing_xp: 200,
          working_target: 1,
          working_xp: 300,
        },
      ],
      [],
      true,
    );
    const { goalsRows } = parseGoalsWorkbook(buffer);
    const ctx = await loadWorkspaceImportContext(seed.workspaceId);
    const preview = validateGoalsImport(ctx, goalsRows, []);
    assert.equal(preview.ok, true);
    const revenue = preview.normalizedGoals.find((g) => g.metricKey === "revenue");
    const testing = preview.normalizedGoals.find((g) => g.metricKey === "testingBatches");
    const working = preview.normalizedGoals.find((g) => g.metricKey === "workingCampaigns");
    assert.equal(revenue?.xpReward, 500);
    assert.equal(testing?.xpReward, 200);
    assert.equal(working?.xpReward, 300);
    assert.equal(revenue?.xpProvided, true);
  });

  it("old sheet without XP columns still parses with defaults", async () => {
    const seed = await seedWorkspace();
    const buffer = buildWorkbook([
      {
        month: "2026-07",
        employee_email: seed.saraEmail,
        employee_name: "Sara",
        affiliate_network: "Yieldkit CBV",
        selected_geos: "GB",
        revenue_target: 1000,
        testing_target: 4,
        working_target: 1,
      },
    ]);
    const { goalsRows } = parseGoalsWorkbook(buffer);
    const ctx = await loadWorkspaceImportContext(seed.workspaceId);
    const preview = validateGoalsImport(ctx, goalsRows, []);
    assert.equal(preview.ok, true);
    assert.equal(preview.rows[0]?.revenueXp, 500);
    assert.equal(preview.rows[0]?.testingXp, 200);
    assert.equal(preview.rows[0]?.workingXp, 300);
    assert.equal(preview.normalizedGoals.every((g) => !g.xpProvided), true);
  });

  it("invalid XP gives row error", async () => {
    const seed = await seedWorkspace();
    const buffer = buildWorkbook(
      [
        {
          month: "2026-07",
          employee_email: seed.saraEmail,
          employee_name: "Sara",
          affiliate_network: "Yieldkit CBV",
          selected_geos: "GB",
          revenue_target: 1000,
          revenue_xp: -1,
          testing_target: 4,
          working_target: 1,
        },
      ],
      [],
      true,
    );
    const { goalsRows } = parseGoalsWorkbook(buffer);
    const ctx = await loadWorkspaceImportContext(seed.workspaceId);
    const preview = validateGoalsImport(ctx, goalsRows, []);
    assert.equal(preview.ok, false);
    assert.match(preview.errors.join(" "), /revenue_xp/i);
  });

  it("blank XP preserves existing xpReward on update", async () => {
    const seed = await seedWorkspace();
    const existing: ServerWorkerGoalTarget[] = [
      {
        id: "wg_sara_rev",
        employeeId: seed.saraId,
        employeeName: "Sara",
        metricKey: "revenue",
        affiliateNetworkName: "Yieldkit CBV",
        monthKey: "2026-07",
        monthlyTarget: 1000,
        isActive: true,
        selectedGeoCodes: ["GB"],
        xpReward: 777,
      },
    ];
    const incoming: NormalizedImportGoal[] = [
      {
        monthKey: "2026-07",
        employeeId: seed.saraId,
        employeeName: "Sara",
        employeeEmail: seed.saraEmail,
        affiliateNetworkId: seed.netA,
        affiliateNetworkName: "Yieldkit CBV",
        selectedGeoCodes: ["GB"],
        geoId: null,
        geoCode: null,
        metricKey: "revenue",
        monthlyTarget: 3000,
        xpReward: null,
        xpProvided: false,
        source: "goals_sheet",
        sourceRowNumber: 2,
      },
    ];
    const { nextGoals } = upsertNormalizedGoals(existing, incoming);
    assert.equal(nextGoals[0]!.xpReward, 777);
  });

  it("provided XP updates existing xpReward", async () => {
    const seed = await seedWorkspace();
    const existing: ServerWorkerGoalTarget[] = [
      {
        id: "wg_sara_rev",
        employeeId: seed.saraId,
        employeeName: "Sara",
        metricKey: "revenue",
        affiliateNetworkName: "Yieldkit CBV",
        monthKey: "2026-07",
        monthlyTarget: 1000,
        isActive: true,
        selectedGeoCodes: ["GB"],
        xpReward: 777,
      },
    ];
    const incoming: NormalizedImportGoal[] = [
      {
        monthKey: "2026-07",
        employeeId: seed.saraId,
        employeeName: "Sara",
        employeeEmail: seed.saraEmail,
        affiliateNetworkId: seed.netA,
        affiliateNetworkName: "Yieldkit CBV",
        selectedGeoCodes: ["GB"],
        geoId: null,
        geoCode: null,
        metricKey: "revenue",
        monthlyTarget: 3000,
        xpReward: 999,
        xpProvided: true,
        source: "goals_sheet",
        sourceRowNumber: 2,
      },
    ];
    const { nextGoals } = upsertNormalizedGoals(existing, incoming);
    assert.equal(nextGoals[0]!.xpReward, 999);
  });

  it("template endpoint buffer has Goals sheet with XP headers and Geo Overrides", async () => {
    const seed = await seedWorkspace();
    const buffer = await buildGoalsImportTemplateBuffer(seed.workspaceId);
    const wb = XLSX.read(buffer, { type: "buffer" });
    assert.ok(wb.Sheets[GOALS_SHEET_NAME]);
    assert.ok(wb.Sheets[GEO_OVERRIDES_SHEET_NAME]);
    const goalsMatrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[GOALS_SHEET_NAME]!, { header: 1 });
    const headers = (goalsMatrix[0] ?? []).map((h) => String(h).trim().toLowerCase());
    assert.ok(headers.includes("revenue_xp"));
    assert.ok(headers.includes("testing_xp"));
    assert.ok(headers.includes("working_xp"));
  });

  it("missing Goals sheet returns explicit error", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"]]), "Sheet1");
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    assert.throws(
      () => parseGoalsWorkbook(buffer),
      /Missing required sheet: Goals/,
    );
  });

  it("header mismatch returns expected vs found headers", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["month", "employee_email"], ["2026-07", "x@example.com"]]),
      GOALS_SHEET_NAME,
    );
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    assert.throws(
      () => parseGoalsWorkbook(buffer),
      /Header mismatch/,
    );
  });

  it("empty Goals sheet returns no data rows error", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[...GOALS_REQUIRED_HEADERS]]),
      GOALS_SHEET_NAME,
    );
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    assert.throws(
      () => parseGoalsWorkbook(buffer),
      /No data rows found in Goals sheet/,
    );
  });
});
