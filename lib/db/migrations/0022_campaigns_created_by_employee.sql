-- 0022_campaigns_created_by_employee.sql
--
-- Adds explicit ownership for manually-created production/live campaigns.
--
-- Context: production campaigns (campaign_purpose in 'working','scaling') were
-- previously admin-only and had no per-employee owner. Feature "Employee Add
-- Manual Campaign" lets workspace members create their own production campaigns.
-- The server sets created_by_employee_id from the authenticated employee only;
-- it is never accepted from the request body.
--
-- Backward compatibility:
--   * Column is NULLABLE. Existing production rows remain NULL (no backfill).
--   * Application code must treat NULL as "owner unknown / legacy".
--   * FK -> employees(id) ON DELETE SET NULL so deleting an employee never
--     deletes campaigns.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS created_by_employee_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'campaigns_created_by_employee_id_employees_id_fk'
      AND table_name = 'campaigns'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_created_by_employee_id_employees_id_fk
      FOREIGN KEY (created_by_employee_id)
      REFERENCES employees(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS campaigns_workspace_created_by_idx
  ON campaigns (workspace_id, created_by_employee_id);
