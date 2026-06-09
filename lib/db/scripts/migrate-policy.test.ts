import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BASELINE_FILENAME,
  assertNoLegacyTrackedMigrations,
  assertPushBasedDbAligned,
  classifyMigration,
  findLegacyTrackedFilenames,
  isActiveMigration,
  selectActiveMigrations,
  sha256,
  type MigrationFile,
} from "./migrate-policy.ts";

function file(name: string): MigrationFile {
  return {
    name,
    fullPath: `/migrations/${name}`,
    kind: classifyMigration(name),
  };
}

describe("classifyMigration", () => {
  test("baseline file is classified as baseline", () => {
    assert.equal(classifyMigration(BASELINE_FILENAME), "baseline");
  });

  test("0001 through 0021 are legacy", () => {
    assert.equal(classifyMigration("0001_task9_batch_automation.sql"), "legacy");
    assert.equal(classifyMigration("0021_operational_activity_feed.sql"), "legacy");
  });

  test("0022 and above are forward migrations", () => {
    assert.equal(classifyMigration("0022_add_widget.sql"), "forward");
  });
});

describe("active migration selection", () => {
  test("selects baseline and forward only", () => {
    const selected = selectActiveMigrations([
      file("0000_baseline.sql"),
      file("0001_task9_batch_automation.sql"),
      file("0021_operational_activity_feed.sql"),
      file("0022_future_change.sql"),
    ]);

    assert.deepEqual(
      selected.map((entry) => entry.name),
      ["0000_baseline.sql", "0022_future_change.sql"],
    );
  });

  test("isActiveMigration excludes legacy files", () => {
    assert.equal(isActiveMigration("0000_baseline.sql"), true);
    assert.equal(isActiveMigration("0003_phase2_automation_bible_schema.sql"), false);
    assert.equal(isActiveMigration("0022_future_change.sql"), true);
  });
});

describe("legacy tracking guards", () => {
  test("findLegacyTrackedFilenames returns only legacy names", () => {
    assert.deepEqual(
      findLegacyTrackedFilenames([
        "0000_baseline.sql",
        "0003_phase2_automation_bible_schema.sql",
        "0022_future_change.sql",
      ]),
      ["0003_phase2_automation_bible_schema.sql"],
    );
  });

  test("assertNoLegacyTrackedMigrations throws for legacy rows", () => {
    assert.throws(
      () => assertNoLegacyTrackedMigrations(["0001_task9_batch_automation.sql"]),
      /Ambiguous database state/,
    );
  });
});

describe("push-based database policy", () => {
  test("requires baseline marker when app schema exists", () => {
    assert.throws(
      () =>
        assertPushBasedDbAligned({
          hasAppSchema: true,
          baselineTracked: false,
        }),
      /db:baseline-align/,
    );
  });

  test("allows clean database without baseline marker", () => {
    assert.doesNotThrow(() =>
      assertPushBasedDbAligned({
        hasAppSchema: false,
        baselineTracked: false,
      }),
    );
  });
});

describe("checksum drift protection", () => {
  test("sha256 is stable for migration contents", () => {
    const first = sha256("CREATE TABLE example (id int);");
    const second = sha256("CREATE TABLE example (id int);");
    assert.equal(first, second);
    assert.notEqual(first, sha256("CREATE TABLE example (id bigint);"));
  });
});
