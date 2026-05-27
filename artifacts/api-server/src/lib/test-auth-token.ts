import { signAuthToken } from "./auth-tokens.ts";

const ROUTE_TEST_SECRET = "offerops-route-test-auth-secret";

/** Signed bearer token for route integration tests. */
export function testAuthToken(employeeId: number): string {
  if (!process.env.AUTH_TOKEN_SECRET?.trim()) {
    process.env.AUTH_TOKEN_SECRET = ROUTE_TEST_SECRET;
  }
  return signAuthToken(employeeId);
}
