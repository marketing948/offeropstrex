-- Per-employee active workspace selection.
--
-- The legacy workspaces.is_active column is global and cannot represent two
-- employees working in different workspaces at the same time. Keep it for
-- backwards-compatible reads, but move activation ownership to employees.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS active_workspace_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employees_active_workspace_id_workspaces_id_fk'
      AND conrelid = 'employees'::regclass
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_active_workspace_id_workspaces_id_fk
      FOREIGN KEY (active_workspace_id)
      REFERENCES workspaces(id)
      ON DELETE SET NULL;
  END IF;
END $$;
