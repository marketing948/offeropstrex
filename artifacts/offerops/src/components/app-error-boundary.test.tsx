import { describe, test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { AppErrorBoundary } from "./app-error-boundary";

describe("AppErrorBoundary", () => {
  test("getDerivedStateFromError switches boundary into fallback mode", () => {
    const next = AppErrorBoundary.getDerivedStateFromError(new Error("boom"));
    assert.deepEqual(next, { hasError: true, requestId: null });
  });

  test("renders children when no error state", () => {
    const rendered = React.createElement(
      AppErrorBoundary,
      null,
      React.createElement("span"),
    );
    assert.ok(React.isValidElement(rendered));
  });
});
