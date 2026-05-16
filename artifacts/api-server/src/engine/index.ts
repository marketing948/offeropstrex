// Phase 3: engine barrel. Public surface used by Phase 4 handlers and
// Phase 5 sync emitters.

export { emit, type EmitResult } from "./event-bus.ts";
export { registerHandler } from "./handlers.ts";
export { applyAction, applyActions } from "./executor.ts";
export type {
  Action,
  ActionType,
  EmittedEvent,
  EventInput,
  EventType,
  Handler,
  Tx,
} from "./types.ts";
