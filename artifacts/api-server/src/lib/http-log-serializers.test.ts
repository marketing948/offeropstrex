import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  serializeHttpRequest,
  serializeHttpResponse,
} from "./http-log-serializers.ts";

describe("http log serializers", () => {
  test("request serializer excludes headers and auth tokens", () => {
    const serialized = serializeHttpRequest({
      id: "req-1",
      method: "GET",
      url: "/api/auth/me?foo=bar",
      // intentionally extra unknown fields
      // @ts-expect-error test payload
      headers: { authorization: "Bearer top-secret-token" },
    });

    assert.deepEqual(serialized, {
      id: "req-1",
      method: "GET",
      url: "/api/auth/me",
    });
    assert.equal("headers" in serialized, false);
    assert.equal(JSON.stringify(serialized).includes("top-secret-token"), false);
  });

  test("response serializer keeps status code only", () => {
    const serialized = serializeHttpResponse({ statusCode: 204 });
    assert.deepEqual(serialized, { statusCode: 204 });
  });
});
