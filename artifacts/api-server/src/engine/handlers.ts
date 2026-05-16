// Phase 3: handler registry. Phase 3 ships the bus + executor with an
// EMPTY registry on purpose — Phase 4 (rule engine) is what actually
// registers business handlers. Until then, `emit()` writes the event
// row, walks zero handlers, and commits cleanly.

import type { EventInput, EventType, Handler } from "./types.ts";

const registry = new Map<EventType, Handler[]>();

/**
 * Register a handler for a single event type. Multiple handlers per
 * type are allowed; they run in registration order inside the same
 * transaction, and any error rolls back the whole `emit()`.
 */
export function registerHandler<T extends EventType>(
  type: T,
  handler: Handler<Extract<EventInput, { type: T }>>,
): void {
  const existing = registry.get(type) ?? [];
  existing.push(handler as Handler);
  registry.set(type, existing);
}

/** Internal — used by the bus to look up handlers for an event. */
export function getHandlers(type: EventType): readonly Handler[] {
  return registry.get(type) ?? [];
}

/**
 * Test-only — clear the registry between tests. Production code never
 * calls this; handlers are registered once at module-load time.
 */
export function _resetRegistryForTests(): void {
  registry.clear();
}
