begin;
-- Additive; do not backfill a phase for legacy jobs whose send outcome is unknown.
-- Deploy only after review and after older workers (max 800s) have drained.
alter table public.accountability_dispatches
  add column processing_token uuid,
  add column processing_started_at timestamptz,
  add column provider_attempted_at timestamptz,
  add column email_snapshot jsonb;
-- Existing RLS, table grants, artifacts and history remain unchanged.
commit;
