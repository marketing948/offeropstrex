import { and, eq } from "drizzle-orm";
import { todoTasksTable } from "@workspace/db";
import type { Action, EventInput, Tx } from "../types.ts";

type TaskCompletionRequestedEvent = Extract<
  EventInput,
  { type: "TaskCompletionRequested" }
>;

export async function handleTaskCompletionRequested(
  event: TaskCompletionRequestedEvent,
  tx: Tx,
): Promise<Action[]> {
  const [task] = await tx
    .select({
      id: todoTasksTable.id,
      status: todoTasksTable.status,
      taskType: todoTasksTable.taskType,
    })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.id, event.payload.taskId),
        eq(todoTasksTable.workspaceId, event.workspaceId),
      ),
    )
    .limit(1);

  if (!task || task.status === "DONE") return [];

  // MANUAL tasks must never use generic / CampaignOps completion shapes.
  const completion =
    task.taskType === "MANUAL" ? ({ kind: "manual" } as const) : event.payload.completion;

  return [
    {
      type: "CompleteTaskFromRequest",
      workspaceId: event.workspaceId,
      taskId: event.payload.taskId,
      completedByEmployeeId: event.payload.completedByEmployeeId,
      completion,
    },
  ];
}
