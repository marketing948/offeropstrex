-- CampaignOps follow-up task de-duplication.
--
-- The typed completion endpoint emits TaskCompleted inside the same
-- transaction that updates the task and Campaign. These indexes make the
-- engine-created follow-up tasks idempotent under retries and races.

ALTER TABLE campaigns
  ALTER COLUMN status SET DEFAULT 'voluum_created';

CREATE UNIQUE INDEX IF NOT EXISTS todo_tasks_open_create_campaign_unique
  ON todo_tasks (workspace_id, related_batch_id, task_type)
  WHERE status IN ('TODO', 'IN_PROGRESS')
    AND task_type IN (
      'create_voluum_campaign_ios',
      'create_voluum_campaign_android'
    );

CREATE UNIQUE INDEX IF NOT EXISTS todo_tasks_open_campaign_followup_unique
  ON todo_tasks (workspace_id, related_campaign_id, task_type)
  WHERE status IN ('TODO', 'IN_PROGRESS')
    AND task_type IN ('take_campaign_live', 'find_winners')
    AND related_campaign_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS todo_tasks_open_campaignops_terminal_unique
  ON todo_tasks (workspace_id, related_batch_id, task_type)
  WHERE status IN ('TODO', 'IN_PROGRESS')
    AND task_type = 'all_traffic_sources_tested';
