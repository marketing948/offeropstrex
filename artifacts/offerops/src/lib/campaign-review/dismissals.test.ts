import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDismissalMap,
  isReviewItemHidden,
  latestSignalTimestamp,
} from "./dismissals.ts";

test("isReviewItemHidden hides when no signal after dismissal", () => {
  const dismissedAt = "2026-07-12T10:00:00.000Z";
  const olderSignal = "2026-07-12T09:00:00.000Z";
  assert.equal(isReviewItemHidden(dismissedAt, olderSignal), true);
});

test("isReviewItemHidden reappears when newer signal/request occurs after dismissal", () => {
  const dismissedAt = "2026-07-12T10:00:00.000Z";
  const newerSignal = "2026-07-12T11:30:00.000Z";
  assert.equal(isReviewItemHidden(dismissedAt, newerSignal), false);
});

test("isReviewItemHidden stays hidden when signal equals dismissal timestamp", () => {
  const t = "2026-07-12T10:00:00.000Z";
  assert.equal(isReviewItemHidden(t, t), true);
});

test("isReviewItemHidden not hidden when never dismissed", () => {
  assert.equal(isReviewItemHidden(null, "2026-07-12T10:00:00.000Z"), false);
  assert.equal(isReviewItemHidden(undefined, null), false);
});

test("isReviewItemHidden hidden when dismissed and no signal timestamp known", () => {
  assert.equal(isReviewItemHidden("2026-07-12T10:00:00.000Z", null), true);
});

test("buildDismissalMap keeps latest dismissal per campaign", () => {
  const map = buildDismissalMap([
    { campaignId: 1, dismissedAt: "2026-07-12T09:00:00.000Z" },
    { campaignId: 1, dismissedAt: "2026-07-12T12:00:00.000Z" },
    { campaignId: 2, dismissedAt: "2026-07-12T08:00:00.000Z" },
  ]);
  assert.equal(map.get(1), "2026-07-12T12:00:00.000Z");
  assert.equal(map.get(2), "2026-07-12T08:00:00.000Z");
});

test("latestSignalTimestamp returns most recent valid timestamp", () => {
  assert.equal(
    latestSignalTimestamp(
      "2026-07-12T09:00:00.000Z",
      null,
      "2026-07-12T11:00:00.000Z",
      "not-a-date",
    ),
    "2026-07-12T11:00:00.000Z",
  );
  assert.equal(latestSignalTimestamp(null, undefined), null);
});
