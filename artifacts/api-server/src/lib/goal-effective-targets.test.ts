import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeNetworkEffectiveTarget,
  resolveEffectiveGeoTargets,
  sortEligibleGeos,
} from "./goal-effective-targets.ts";

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
