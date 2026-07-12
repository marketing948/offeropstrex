export type ClientErrorContext = {
  source:
    | "error-boundary"
    | "drawer-error-boundary"
    | "window-error"
    | "window-unhandledrejection";
  requestId?: string | null;
};

export function reportClientError(error: unknown, context: ClientErrorContext): void {
  const payload = {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
    source: context.source,
    requestId: context.requestId ?? null,
  };

  // Intentional central hook for Sentry/OTel later.
  if (import.meta.env.DEV) {
    console.error("[OfferOps client error]", payload);
    return;
  }

  console.error("[OfferOps client error]", {
    ...payload,
    message: "A client error occurred.",
  });
}
