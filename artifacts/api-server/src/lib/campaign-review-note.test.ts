import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectLatestReviewNote,
  CAMPAIGN_REVIEW_REQUESTED,
  CAMPAIGN_REVIEW_NOTE_UPDATED,
} from "./campaign-review-requests.ts";

function row(eventType: string, note: string, iso: string, id: number) {
  return {
    eventType,
    payloadJson: { note },
    createdAt: new Date(iso),
    id,
  };
}

test("selectLatestReviewNote returns the original request note when no edits", () => {
  const rows = [
    row(CAMPAIGN_REVIEW_REQUESTED, "first note", "2026-07-12T09:00:00.000Z", 1),
  ];
  assert.equal(selectLatestReviewNote(rows), "first note");
});

test("selectLatestReviewNote returns the latest edited note", () => {
  const rows = [
    row(CAMPAIGN_REVIEW_REQUESTED, "first note", "2026-07-12T09:00:00.000Z", 1),
    row(CAMPAIGN_REVIEW_NOTE_UPDATED, "edited note", "2026-07-12T10:00:00.000Z", 2),
  ];
  assert.equal(selectLatestReviewNote(rows), "edited note");
});

test("selectLatestReviewNote is order-independent (no ambiguous display order)", () => {
  const rows = [
    row(CAMPAIGN_REVIEW_NOTE_UPDATED, "edited note", "2026-07-12T10:00:00.000Z", 2),
    row(CAMPAIGN_REVIEW_REQUESTED, "first note", "2026-07-12T09:00:00.000Z", 1),
  ];
  assert.equal(selectLatestReviewNote(rows), "edited note");
  // reversed input, same result
  assert.equal(selectLatestReviewNote([...rows].reverse()), "edited note");
});

test("selectLatestReviewNote breaks createdAt ties by event id", () => {
  const same = "2026-07-12T10:00:00.000Z";
  const rows = [
    row(CAMPAIGN_REVIEW_REQUESTED, "old", same, 5),
    row(CAMPAIGN_REVIEW_NOTE_UPDATED, "new", same, 9),
  ];
  assert.equal(selectLatestReviewNote(rows), "new");
});

test("selectLatestReviewNote supports cleared (empty) note as latest value", () => {
  const rows = [
    row(CAMPAIGN_REVIEW_REQUESTED, "first note", "2026-07-12T09:00:00.000Z", 1),
    row(CAMPAIGN_REVIEW_NOTE_UPDATED, "", "2026-07-12T11:00:00.000Z", 3),
  ];
  assert.equal(selectLatestReviewNote(rows), "");
});

test("selectLatestReviewNote returns empty string when no note events", () => {
  assert.equal(selectLatestReviewNote([]), "");
});
