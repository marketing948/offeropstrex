import { useState } from "react";
import { Loader2, Wrench } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  postBatchRecovery,
  type BatchRecoveryAction,
} from "@/lib/batch-recovery-api";

const ACTIONS: {
  action: BatchRecoveryAction;
  label: string;
  description: string;
  confirm?: boolean;
}[] = [
  {
    action: "recreate-create-tasks",
    label: "Recreate create tasks",
    description: "Seed missing iOS/Android Voluum create tasks for the active run.",
  },
  {
    action: "replay-find-winners",
    label: "Replay find winners",
    description: "Re-run find-winners completion handling for the active run (idempotent).",
    confirm: true,
  },
  {
    action: "mark-run-reviewed",
    label: "Mark run reviewed",
    description: "Record that an operator reviewed this batch (telemetry only).",
  },
];

export type BatchHealthDrawerRecoveryProps = {
  batchId: number;
  onSuccess: () => Promise<unknown>;
};

export function BatchHealthDrawerRecovery({
  batchId,
  onSuccess,
}: BatchHealthDrawerRecoveryProps) {
  const { toast } = useToast();
  const [pending, setPending] = useState<BatchRecoveryAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<BatchRecoveryAction | null>(null);

  const runAction = async (action: BatchRecoveryAction) => {
    setPending(action);
    try {
      const result = await postBatchRecovery(batchId, action);
      const idempotent = result.idempotent ? " (no changes needed)" : "";
      toast({
        title: "Recovery complete",
        description: `${action.replace(/-/g, " ")}${idempotent}`,
      });
      await onSuccess();
    } catch (err) {
      toast({
        title: "Recovery failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setPending(null);
      setConfirmAction(null);
    }
  };

  const handleClick = (action: BatchRecoveryAction, needsConfirm?: boolean) => {
    if (needsConfirm) {
      setConfirmAction(action);
      return;
    }
    void runAction(action);
  };

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Wrench className="h-3.5 w-3.5" />
        Recovery actions
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">Admin only · uses existing repair endpoints</p>
      <div className="flex flex-col gap-2">
        {ACTIONS.map(({ action, label, description, confirm }) => (
          <Button
            key={action}
            type="button"
            variant="outline"
            size="sm"
            className="h-auto justify-start px-3 py-2 text-left"
            disabled={pending !== null}
            onClick={() => handleClick(action, confirm)}
          >
            <span className="flex w-full items-center gap-2">
              {pending === action ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold">{label}</span>
                <span className="block text-[10px] font-normal text-muted-foreground">{description}</span>
              </span>
            </span>
          </Button>
        ))}
      </div>

      <AlertDialog open={confirmAction !== null} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm replay find winners?</AlertDialogTitle>
            <AlertDialogDescription>
              This re-processes find-winners completion for the active traffic source run. It is
              designed to be idempotent, but only run when you intend to repair progression.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending !== null || !confirmAction}
              onClick={(e) => {
                e.preventDefault();
                if (confirmAction) void runAction(confirmAction);
              }}
            >
              {pending === confirmAction ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Replay find winners
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
