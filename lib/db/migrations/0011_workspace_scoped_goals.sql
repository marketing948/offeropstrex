-- Workspace-scope goals.
--
-- Goals are employee-owned but must also be workspace-scoped so dashboard and
-- goals routes cannot leak data across a user's assigned workspaces.

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS workspace_id integer;

WITH first_assignment AS (
  SELECT DISTINCT ON (employee_id)
    employee_id,
    workspace_id
  FROM employee_workspace_assignments
  ORDER BY employee_id, workspace_id
),
fallback_workspace AS (
  SELECT id
  FROM workspaces
  ORDER BY is_default DESC, id
  LIMIT 1
)
UPDATE goals AS g
SET workspace_id = COALESCE(g.workspace_id, e.active_workspace_id, fa.workspace_id, fw.id)
FROM employees AS e
LEFT JOIN first_assignment AS fa ON fa.employee_id = e.id
CROSS JOIN fallback_workspace AS fw
WHERE g.employee_id = e.id
  AND g.workspace_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM goals WHERE workspace_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce goals.workspace_id: existing goals could not be assigned to a workspace';
  END IF;
END $$;

ALTER TABLE goals
  ALTER COLUMN workspace_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'goals_workspace_id_workspaces_id_fk'
      AND conrelid = 'goals'::regclass
  ) THEN
    ALTER TABLE goals
      ADD CONSTRAINT goals_workspace_id_workspaces_id_fk
      FOREIGN KEY (workspace_id)
      REFERENCES workspaces(id)
      ON DELETE CASCADE;
  END IF;
END $$;
