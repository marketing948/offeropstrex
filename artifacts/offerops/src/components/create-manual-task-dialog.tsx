import { useState } from "react";
import {
  useListEmployees,
  getListEmployeesQueryKey,
  getListTodoTasksQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { authedJson } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/lib/workspace-context";
import { wsQueryOpts } from "@/lib/ws-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CreateManualTaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateManualTaskDialog({ open, onOpenChange }: CreateManualTaskDialogProps) {
  const { activeWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const wsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const { data: employees = [] } = useListEmployees(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(wsParams)),
  );

  const [title, setTitle] = useState("");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!activeWorkspaceId) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const assigneeId = Number(assignedEmployeeId);
    if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
      toast({ title: "Assignee is required", variant: "destructive" });
      return;
    }

    setPending(true);
    try {
      await authedJson("/api/todo-tasks/manual", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          title: trimmedTitle,
          assignedEmployeeId: assigneeId,
          description: description.trim() || undefined,
          dueAt: dueAt.trim() ? new Date(dueAt).toISOString() : undefined,
          priority,
        }),
      });
      toast({ title: "Manual task created" });
      await queryClient.invalidateQueries({
        queryKey: getListTodoTasksQueryKey({ workspace_id: activeWorkspaceId }),
      });
      setTitle("");
      setAssignedEmployeeId("");
      setDescription("");
      setDueAt("");
      setPriority("medium");
      onOpenChange(false);
    } catch (e: unknown) {
      toast({
        title: "Could not create task",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create manual task</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Assign a one-off reminder to a workspace member. This does not start CampaignOps automation.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title *</Label>
            <Input
              className="mt-1 h-9"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
            />
          </div>
          <div>
            <Label className="text-xs">Assign to *</Label>
            <Select value={assignedEmployeeId} onValueChange={setAssignedEmployeeId}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={String(emp.id)}>
                    {emp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Due (optional)</Label>
            <Input
              type="datetime-local"
              className="mt-1 h-9"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              className="mt-1 min-h-[4rem]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details for the assignee"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => void submit()} disabled={pending}>
            {pending ? "Creating…" : "Create task"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}