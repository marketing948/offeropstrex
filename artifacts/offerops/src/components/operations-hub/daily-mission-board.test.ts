import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDailyMissionRows,
  buildMissionBoardHeader,
  computeDailyMissionBar,
  countOfferCountFixedToday,
  countTestingCreatedToday,
  countWorkingCreatedToday,
  isSameLocalDay,
  toMissionCampaignRow,
} from "./daily-mission-board.ts";
import type { FocusItem, TodaysFocus } from "./ops-goal-focus.ts";

const NOW = new Date("2026-07-08T12:00:00Z");

function testingItem(overrides: Partial<FocusItem["context"]> = {}): FocusItem {
  return {
    tier: "primary",
    emoji: "🧪",
    title: "Testing focus",
    text: "Create 3 testing campaigns today for Yieldkit CBV / GB",
    context: {
      actionType: "testing_action",
      actionLabel: "Create campaigns",
      network: "Yieldkit CBV",
      geo: "GB",
      todayTarget: "3",
      dailyTargetUnits: 3,
      missionCategory: "testing",
      currentValue: "5",
      expectedByNow: "8",
      paceGapLabel: "3 behind",
      ...overrides,
    },
  };
}

function workingItem(overrides: Partial<FocusItem["context"]> = {}): FocusItem {
  return {
    tier: "primary",
    emoji: "📡",
    title: "Working focus",
    text: "Launch/move 2 working campaigns for Yieldkit CBV / GB",
    context: {
      actionType: "working_action",
      actionLabel: "Launch/move campaigns",
      network: "Yieldkit CBV",
      geo: "GB",
      todayTarget: "2",
      dailyTargetUnits: 2,
      missionCategory: "working",
      ...overrides,
    },
  };
}

describe("isSameLocalDay", () => {
  test("matches same calendar day", () => {
    assert.equal(isSameLocalDay("2026-07-08T09:00:00Z", NOW), true);
    assert.equal(isSameLocalDay("2026-07-07T09:00:00Z", NOW), false);
  });
});

describe("toMissionCampaignRow", () => {
  test("maps purpose and date fields explicitly", () => {
    const row = toMissionCampaignRow({
      id: 5,
      campaignPurpose: "testing",
      status: "live",
      createdAt: "2026-07-08T10:00:00Z",
      updatedAt: "2026-07-08T11:00:00Z",
      liveStartedAt: "2026-07-08T10:00:00Z",
      offerCount: 2,
      affiliateNetworkName: "Yieldkit CBV",
      batchGeo: "GB",
      employeeId: 9,
    });
    assert.ok(row);
    assert.equal(row!.campaignPurpose, "testing");
    assert.equal(row!.createdAt, "2026-07-08T10:00:00Z");
    assert.equal(row!.updatedAt, "2026-07-08T11:00:00Z");
    assert.equal(row!.liveStartedAt, "2026-07-08T10:00:00Z");
    assert.equal(row!.network, "Yieldkit CBV");
    assert.equal(row!.geo, "GB");
  });

  test("unknown purpose when missing", () => {
    const row = toMissionCampaignRow({
      id: 1,
      status: "live",
      createdAt: "2026-07-08T10:00:00Z",
    });
    assert.equal(row!.campaignPurpose, "unknown");
  });
});

describe("countTestingCreatedToday", () => {
  test("testing campaign created today increments Testing only", () => {
    const campaigns = [
      {
        id: 1,
        status: "live",
        campaignPurpose: "testing",
        createdAt: "2026-07-08T10:00:00Z",
        affiliateNetworkName: "Yieldkit CBV",
        batchGeo: "GB",
      },
      {
        id: 2,
        status: "live",
        campaignPurpose: "working",
        createdAt: "2026-07-08T10:00:00Z",
        affiliateNetworkName: "Yieldkit CBV",
        batchGeo: "GB",
      },
    ];
    const testing = countTestingCreatedToday(campaigns, {
      now: NOW,
      network: "Yieldkit CBV",
      geo: "GB",
    });
    const working = countWorkingCreatedToday(campaigns, {
      now: NOW,
      network: "Yieldkit CBV",
      geo: "GB",
    });
    assert.equal(testing.count, 1);
    assert.equal(working.count, 1);
    assert.equal(testing.source, "createdAt");
  });

  test("working campaign created today does NOT increment Testing", () => {
    const testing = countTestingCreatedToday(
      [
        {
          id: 2,
          status: "live",
          campaignPurpose: "working",
          createdAt: "2026-07-08T10:00:00Z",
          affiliateNetworkName: "Yieldkit CBV",
          batchGeo: "GB",
        },
      ],
      { now: NOW, network: "Yieldkit CBV", geo: "GB" },
    );
    assert.equal(testing.count, 0);
  });

  test("ambiguous purpose does not count toward Testing", () => {
    const testing = countTestingCreatedToday(
      [
        {
          id: 3,
          status: "live",
          createdAt: "2026-07-08T10:00:00Z",
          affiliateNetworkName: "Yieldkit CBV",
          batchGeo: "GB",
        },
      ],
      { now: NOW, network: "Yieldkit CBV", geo: "GB" },
    );
    assert.equal(testing.count, 0);
    assert.equal(testing.source, "none");
  });
});

describe("countWorkingCreatedToday", () => {
  test("working campaign created today increments Working only", () => {
    const campaigns = [
      {
        id: 1,
        status: "live",
        campaignPurpose: "working",
        createdAt: "2026-07-08T10:00:00Z",
        affiliateNetworkName: "Yieldkit CBV",
        batchGeo: "GB",
      },
      {
        id: 2,
        status: "live",
        campaignPurpose: "testing",
        createdAt: "2026-07-08T10:00:00Z",
        affiliateNetworkName: "Yieldkit CBV",
        batchGeo: "GB",
      },
    ];
    assert.equal(
      countWorkingCreatedToday(campaigns, { now: NOW, network: "Yieldkit CBV", geo: "GB" }).count,
      1,
    );
    assert.equal(
      countTestingCreatedToday(campaigns, { now: NOW, network: "Yieldkit CBV", geo: "GB" }).count,
      1,
    );
  });

  test("testing campaign created today does NOT increment Working", () => {
    const working = countWorkingCreatedToday(
      [
        {
          id: 2,
          status: "live",
          campaignPurpose: "testing",
          createdAt: "2026-07-08T10:00:00Z",
          affiliateNetworkName: "Yieldkit CBV",
          batchGeo: "GB",
        },
      ],
      { now: NOW, network: "Yieldkit CBV", geo: "GB" },
    );
    assert.equal(working.count, 0);
  });

  test("ambiguous purpose does not count toward Working", () => {
    const working = countWorkingCreatedToday(
      [
        {
          id: 3,
          status: "live",
          createdAt: "2026-07-08T10:00:00Z",
          affiliateNetworkName: "Yieldkit CBV",
          batchGeo: "GB",
        },
      ],
      { now: NOW, network: "Yieldkit CBV", geo: "GB" },
    );
    assert.equal(working.count, 0);
    assert.equal(working.source, "none");
  });
});

describe("Network/GEO matching", () => {
  test("campaign created today only counts matching mission slice", () => {
    const campaigns = [
      {
        id: 1,
        status: "live",
        campaignPurpose: "testing",
        createdAt: "2026-07-08T10:00:00Z",
        affiliateNetworkName: "Yieldkit CBV",
        batchGeo: "GB",
      },
      {
        id: 2,
        status: "live",
        campaignPurpose: "testing",
        createdAt: "2026-07-08T10:00:00Z",
        affiliateNetworkName: "BlueAffiliate CBV",
        batchGeo: "DE",
      },
    ];
    assert.equal(
      countTestingCreatedToday(campaigns, {
        now: NOW,
        network: "Yieldkit CBV",
        geo: "GB",
      }).count,
      1,
    );
    assert.equal(
      countTestingCreatedToday(campaigns, {
        now: NOW,
        network: "BlueAffiliate CBV",
        geo: "DE",
      }).count,
      1,
    );
    assert.equal(
      countTestingCreatedToday(campaigns, {
        now: NOW,
        network: "Yieldkit CBV",
        geo: "US",
      }).count,
      0,
    );
  });
});

describe("countOfferCountFixedToday", () => {
  test("fixed today counts only if updatedAt exists and offerCount > 0", () => {
    const withUpdated = countOfferCountFixedToday(
      [
        {
          id: 1,
          status: "live",
          campaignPurpose: "working",
          offerCount: 2,
          updatedAt: "2026-07-08T10:00:00Z",
        },
      ],
      { now: NOW, campaignIds: [1] },
    );
    assert.equal(withUpdated.count, 1);
    assert.equal(withUpdated.source, "updatedAt");

    const withoutUpdated = countOfferCountFixedToday(
      [
        {
          id: 2,
          status: "live",
          campaignPurpose: "working",
          offerCount: 2,
          updatedAt: null,
        },
      ],
      { now: NOW, campaignIds: [2] },
    );
    assert.equal(withoutUpdated.count, 0);
    assert.equal(withoutUpdated.hasUpdatedAt, false);
  });
});

describe("computeDailyMissionBar purpose separation", () => {
  test("testing and working chips only use matching purpose completions", () => {
    const focus: TodaysFocus = {
      empty: false,
      items: [
        testingItem({ dailyTargetUnits: 3 }),
        workingItem({ dailyTargetUnits: 2 }),
      ],
    };
    const rows = buildDailyMissionRows(
      focus,
      [
        {
          id: 10,
          status: "live",
          campaignPurpose: "testing",
          createdAt: "2026-07-08T08:00:00Z",
          affiliateNetworkName: "Yieldkit CBV",
          batchGeo: "GB",
        },
        {
          id: 11,
          status: "live",
          campaignPurpose: "working",
          createdAt: "2026-07-08T09:00:00Z",
          affiliateNetworkName: "Yieldkit CBV",
          batchGeo: "GB",
        },
        {
          id: 12,
          status: "live",
          // ambiguous — must not help either chip
          createdAt: "2026-07-08T09:30:00Z",
          affiliateNetworkName: "Yieldkit CBV",
          batchGeo: "GB",
        },
      ],
      { now: NOW },
    );
    const bar = computeDailyMissionBar(rows);
    const testingChip = bar.chips.find((c) => c.key === "testing");
    const workingChip = bar.chips.find((c) => c.key === "working");
    assert.equal(testingChip?.completed, 1);
    assert.equal(testingChip?.total, 3);
    assert.equal(workingChip?.completed, 1);
    assert.equal(workingChip?.total, 2);
    assert.equal(bar.completedActions, 2);
    assert.equal(bar.totalActions, 5);
  });

  test("caps completed at target", () => {
    const rows = buildDailyMissionRows(
      {
        empty: false,
        items: [testingItem({ dailyTargetUnits: 2 })],
      },
      [
        {
          id: 1,
          status: "live",
          campaignPurpose: "testing",
          createdAt: "2026-07-08T01:00:00Z",
          affiliateNetworkName: "Yieldkit CBV",
          batchGeo: "GB",
        },
        {
          id: 2,
          status: "live",
          campaignPurpose: "testing",
          createdAt: "2026-07-08T02:00:00Z",
          affiliateNetworkName: "Yieldkit CBV",
          batchGeo: "GB",
        },
        {
          id: 3,
          status: "live",
          campaignPurpose: "testing",
          createdAt: "2026-07-08T03:00:00Z",
          affiliateNetworkName: "Yieldkit CBV",
          batchGeo: "GB",
        },
      ],
      { now: NOW },
    );
    assert.equal(rows[0]!.mission.completedTodayUnits, 2);
    assert.equal(computeDailyMissionBar(rows).completedActions, 2);
  });

  test("max 5 visible actions and success when none", () => {
    const many: FocusItem[] = Array.from({ length: 8 }, (_, i) =>
      testingItem({ network: `Net${i}`, dailyTargetUnits: 1 }),
    );
    const rows = buildDailyMissionRows({ empty: false, items: many }, [], { now: NOW });
    assert.ok(rows.length <= 5);
    assert.equal(computeDailyMissionBar([]).isSuccess, true);
  });

  test("does not count advisory revenue as completed", () => {
    const rows = buildDailyMissionRows(
      {
        empty: false,
        items: [
          {
            tier: "tertiary",
            emoji: "💵",
            title: "Revenue rescue",
            text: "Revenue is behind pace",
            context: {
              actionType: "revenue_rescue",
              dailyTargetUnits: 1,
              missionCategory: "revenue",
            },
          },
        ],
      },
      [],
      { now: NOW },
    );
    const bar = computeDailyMissionBar(rows);
    assert.equal(bar.completedActions, 0);
    assert.equal(bar.totalActions, 1);
  });
});

describe("admin mission board header", () => {
  test("admin intervention rows include employee names in chips", () => {
    const rows = buildDailyMissionRows(
      {
        empty: false,
        items: [
          {
            ...testingItem(),
            text: "Sara needs 3 testing campaigns on Yieldkit CBV / GB",
            context: {
              ...testingItem().context,
              employeeName: "Sara",
              dailyTargetUnits: 3,
            },
          },
          {
            tier: "secondary",
            emoji: "🧩",
            title: "Campaign health",
            text: "Kida has 1 campaign missing offer count",
            context: {
              actionType: "campaign_health",
              employeeName: "Kida",
              dailyTargetUnits: 1,
              missionCategory: "fixes",
              metricValue: "1",
            },
          },
        ],
      },
      [],
      { now: NOW, isAdminAllEmployees: true },
    );
    const bar = computeDailyMissionBar(rows);
    assert.ok(bar.employeeChips.some((e) => e.name === "Sara"));
    assert.ok(bar.employeeChips.some((e) => e.name === "Kida"));

    const header = buildMissionBoardHeader({
      isWorker: false,
      isAdminAllEmployees: true,
      bar,
      visibleRows: rows.length,
    });
    assert.match(header.title, /Team intervention/i);
  });
});
