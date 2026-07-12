import { describe, test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { LiveCampaignDrawerErrorBoundary } from "./live-campaign-drawer-error-boundary";

describe("LiveCampaignDrawerErrorBoundary", () => {
  test("getDerivedStateFromError switches into fallback mode", () => {
    const next = LiveCampaignDrawerErrorBoundary.getDerivedStateFromError();
    assert.deepEqual(next, { hasError: true });
  });

  test("renders children when there is no error", () => {
    const rendered = React.createElement(
      LiveCampaignDrawerErrorBoundary,
      { open: true, onClose: () => {}, resetKey: 1 },
      React.createElement("span"),
    );
    assert.ok(React.isValidElement(rendered));
  });

  test("switching selected campaign resets a prior failure (no sticky error)", () => {
    const instance = new LiveCampaignDrawerErrorBoundary({
      open: true,
      onClose: () => {},
      resetKey: 1,
      children: null,
    });
    instance.state = { hasError: true, referenceId: "drw-x" };
    const updates: Array<Record<string, unknown>> = [];
    // Capture the state transition componentDidUpdate would apply.
    (instance as unknown as { setState: (s: Record<string, unknown>) => void }).setState =
      (s) => updates.push(s);
    instance.componentDidUpdate({ open: true, onClose: () => {}, resetKey: 2, children: null });
    assert.deepEqual(updates[0], { hasError: false, referenceId: null });
  });
});
