-- Pivot Phase 4 (Task #27) — race protection for batch-level
-- auto-generated tasks. Concurrent CampaignStatusChanged emits
-- (ios + android flipping at once) could race past the rule's
-- existing-task SELECT. This partial unique index makes the second
-- INSERT silently no-op via ON CONFLICT DO NOTHING in the executor.
--
-- Restricted to OPEN rows of the five Phase-4 task types so DONE
-- rows still serve as history.
CREATE UNIQUE INDEX IF NOT EXISTS todo_tasks_open_batch_auto_unique
  ON todo_tasks (workspace_id, related_batch_id, task_type)
  WHERE status IN ('TODO', 'IN_PROGRESS')
    AND task_type IN (
      'CREATE_IOS_CAMPAIGN',
      'CREATE_ANDROID_CAMPAIGN',
      'GO_LIVE',
      'OPTIMIZATION_FOLLOWUP',
      'MOVE_WINNERS_TO_SCALED_CAMPAIGN'
    );
