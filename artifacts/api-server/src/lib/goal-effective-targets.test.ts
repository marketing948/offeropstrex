import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeNetworkEffectiveTarget,
  eligibleGeosForNetwork,
  resolveEffectiveGeoTargets,
  sortEligibleGeos,
} from "./goal-effective-targets.ts";
import type { ServerWorkerGoalTarget } from "./goals-config-server.ts";

const TEN_GEOS = ["AU", "CA", "DE", "ES", "FR", "GB", "IT", "NL", "PL", "US"];

describe("sortEligibleGeos", () => {
  it("sorts case-insensitively ascending", () => {
    assert.deepEqual(sortEligibleGeos(["gb", "AU", "fr"]), ["AU", "fr", "gb"]);
  });
});

describe("resolveEffectiveGeoTargets — revenue", () => {
  it("equal distribution with no explicit overrides", () => {
    const result = resolveEffectiveGeoTargets({
      metricKind: "revenue",
      networkTarget: 10000,
      explicitGeoTargets: new Map(),
      eligibleGeos: TEN_GEOS,
    });
    assert.equal(result.effectiveNetworkTarget, 10000);
    assert.equal(result.geos.length, 10);
    for (const row of result.geos) {
      assert.equal(row.target, 1000);
      assert.equal(row.source, "inherited");
    }
  });

  it("explicit override increases effective network total", () => {
    const result = resolveEffectiveGeoTargets({
      metricKind: "revenue",
      networkTarget: 10000,
      explicitGeoTargets: new Map([["GB", 3000]]),
      eligibleGeos: TEN_GEOS,
    });
    const gb = result.geos.find((g) => g.geo === "GB");
    assert.equal(gb?.target, 3000);
    assert.equal(gb?.source, "custom");
    assert.equal(result.geos.filter((g) => g.geo !== "GB").every((g) => g.target === 1000), true);
    assert.equal(result.effectiveNetworkTarget, 12000);
  });

  it("explicit zero override reduces effective network total", () => {
    const result = resolveEffectiveGeoTargets({
      metricKind: "revenue",
      networkTarget: 10000,
      explicitGeoTargets: new Map([["GB", 0]]),
      eligibleGeos: TEN_GEOS,
    });
    const gb = result.geos.find((g) => g.geo === "GB");
    assert.equal(gb?.target, 0);
    assert.equal(gb?.source, "custom");
    assert.equal(result.effectiveNetworkTarget, 9000);
  });
});

describe("resolveEffectiveGeoTargets — count metrics", () => {
  it("distributes integer counts deterministically", () => {
    const result = resolveEffectiveGeoTargets({
      metricKind: "count",
      networkTarget: 36,
      explicitGeoTargets: new Map(),
      eligibleGeos: TEN_GEOS,
    });
    assert.equal(result.effectiveNetworkTarget, 36);
    const fours = result.geos.filter((g) => g.target === 4);
    const threes = result.geos.filter((g) => g.target === 3);
    assert.equal(fours.length, 6);
    assert.equal(threes.length, 4);
    assert.deepEqual(
      fours.map((g) => g.geo),
      ["AU", "CA", "DE", "ES", "FR", "GB"],
    );
  });

  it("explicit override replaces default share for that GEO", () => {
    const result = resolveEffectiveGeoTargets({
      metricKind: "count",
      networkTarget: 36,
      explicitGeoTargets: new Map([["GB", 7]]),
      eligibleGeos: TEN_GEOS,
    });
    const gb = result.geos.find((g) => g.geo === "GB");
    assert.equal(gb?.target, 7);
    assert.equal(result.effectiveNetworkTarget, 39);
  });
});

describe("resolveEffectiveGeoTargets — no eligible GEOs", () => {
  it("keeps network target without fake GEO rows", () => {
    const result = resolveEffectiveGeoTargets({
      metricKind: "count",
      networkTarget: 16,
      explicitGeoTargets: new Map(),
      eligibleGeos: [],
    });
    assert.deepEqual(result.geos, []);
    assert.equal(result.effectiveNetworkTarget, 16);
  });
});

describe("computeNetworkEffectiveTarget — working explicit zero", () => {
  it("GB zero with four GEO defaults of four each totals twelve", () => {
    const geos = ["AU", "CA", "DE", "GB"];
    const { effectiveNetworkTarget, geos: rows } = computeNetworkEffectiveTarget(
      "Shoplooks FXH",
      [
        {
          id: "1",
          employeeId: 42,
          affiliateNetworkName: "Shoplooks FXH",
          metricKey: "workingCampaigns",
          monthlyTarget: 16,
          isActive: true,
        },
        {
          id: "2",
          employeeId: 42,
          affiliateNetworkName: "Shoplooks FXH",
          geoCode: "GB",
          metricKey: "workingCampaigns",
          monthlyTarget: 0,
          isActive: true,
        },
      ],
      "workingCampaigns",
      42,
      geos,
    );
    const gb = rows.find((g) => g.geo === "GB");
    assert.equal(gb?.target, 0);
    assert.equal(rows.filter((g) => g.geo !== "GB").every((g) => g.target === 4), true);
    assert.equal(effectiveNetworkTarget, 12);
  });
});

describe("selectedGeoCodes priority", () => {
  const networkGoals: ServerWorkerGoalTarget[] = [
    {
      id: "net-testing",
      employeeId: 44,
      affiliateNetworkName: "Linkhaitao SLG",
      metricKey: "testingBatches",
      monthlyTarget: 14,
      isActive: true,
      monthKey: "2026-06",
      selectedGeoCodes: ["CA", "DE", "FR", "GB"],
    },
  ];

  it("returns GEO rows with inherited targets and zero current when no activity", () => {
    const { geos, effectiveNetworkTarget } = computeNetworkEffectiveTarget(
      "Linkhaitao SLG",
      networkGoals,
      "testingBatches",
      44,
      [],
    );
    assert.equal(geos.length, 4);
    assert.equal(effectiveNetworkTarget, 14);
    assert.equal(geos.every((g) => g.source === "inherited"), true);
    assert.equal(geos.reduce((s, g) => s + g.target, 0), 14);
  });

  it("does not include activity GEOs outside selectedGeoCodes", () => {
    const eligible = eligibleGeosForNetwork(
      "Linkhaitao SLG",
      networkGoals,
      "testingBatches",
      44,
      ["US", "JP"],
    );
    assert.deepEqual(eligible, ["CA", "DE", "FR", "GB"]);
  });

  it("revenue split across selected GEOs without activity", () => {
    const goals: ServerWorkerGoalTarget[] = [
      {
        id: "net-rev",
        employeeId: 44,
        affiliateNetworkName: "Linkhaitao SLG",
        metricKey: "revenue",
        monthlyTarget: 10000,
        isActive: true,
        monthKey: "2026-06",
        selectedGeoCodes: ["CA", "DE", "FR", "GB", "IT", "NL", "PL", "US"],
      },
    ];
    const { geos, effectiveNetworkTarget } = computeNetworkEffectiveTarget(
      "Linkhaitao SLG",
      goals,
      "revenue",
      44,
      [],
    );
    assert.equal(geos.length, 8);
    assert.equal(effectiveNetworkTarget, 10000);
    assert.equal(geos[0].target, 1250);
  });

  it("revenue override with selectedGeoCodes", () => {
    const goals: ServerWorkerGoalTarget[] = [
      {
        id: "net-rev",
        employeeId: 44,
        affiliateNetworkName: "Linkhaitao SLG",
        metricKey: "revenue",
        monthlyTarget: 10000,
        isActive: true,
        monthKey: "2026-06",
        selectedGeoCodes: ["CA", "DE", "FR", "GB", "IT", "NL", "PL", "US"],
      },
      {
        id: "geo-gb",
        employeeId: 44,
        affiliateNetworkName: "Linkhaitao SLG",
        geoCode: "GB",
        metricKey: "revenue",
        monthlyTarget: 3000,
        isActive: true,
        monthKey: "2026-06",
      },
    ];
    const { geos, effectiveNetworkTarget } = computeNetworkEffectiveTarget(
      "Linkhaitao SLG",
      goals,
      "revenue",
      44,
      [],
    );
    const gb = geos.find((g) => g.geo === "GB");
    assert.equal(gb?.target, 3000);
    assert.equal(effectiveNetworkTarget, 11750);
  });

  it("explicit zero with selectedGeoCodes", () => {
    const goals: ServerWorkerGoalTarget[] = [
      {
        id: "net-rev",
        employeeId: 44,
        affiliateNetworkName: "Linkhaitao SLG",
        metricKey: "revenue",
        monthlyTarget: 10000,
        isActive: true,
        monthKey: "2026-06",
        selectedGeoCodes: ["CA", "DE", "FR", "GB", "IT", "NL", "PL", "US"],
      },
      {
        id: "geo-gb",
        employeeId: 44,
        affiliateNetworkName: "Linkhaitao SLG",
        geoCode: "GB",
        metricKey: "revenue",
        monthlyTarget: 0,
        isActive: true,
        monthKey: "2026-06",
      },
    ];
    const { effectiveNetworkTarget } = computeNetworkEffectiveTarget(
      "Linkhaitao SLG",
      goals,
      "revenue",
      44,
      [],
    );
    assert.equal(effectiveNetworkTarget, 8750);
  });
});

describe("legacy fallback without selectedGeoCodes", () => {
  it("uses activity GEOs when selectedGeoCodes missing", () => {
    const goals: ServerWorkerGoalTarget[] = [
      {
        id: "net",
        employeeId: 42,
        affiliateNetworkName: "Yieldkit CBV",
        metricKey: "testingBatches",
        monthlyTarget: 18,
        isActive: true,
        monthKey: "2026-06",
      },
    ];
    const eligible = eligibleGeosForNetwork(
      "Yieldkit CBV",
      goals,
      "testingBatches",
      42,
      ["GB"],
    );
    assert.deepEqual(eligible, ["GB"]);
  });
});
