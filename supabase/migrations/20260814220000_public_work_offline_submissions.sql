begin;

-- O identificador gerado no aparelho torna os reenvios da fila offline
-- idempotentes. A conclusão separada permite retomar um envio interrompido
-- entre o upload da foto e a atualização da microetapa.
alter table public.construction_evidence
  add column if not exists client_submission_id uuid,
  add column if not exists submission_completed_at timestamptz;

create unique index if not exists construction_evidence_client_submission_uidx
  on public.construction_evidence(client_submission_id)
  where client_submission_id is not null;

comment on column public.construction_evidence.client_submission_id is
  'Identificador idempotente criado no dispositivo para envios públicos online ou offline.';
comment on column public.construction_evidence.submission_completed_at is
  'Confirma que evidência, avanço e estoque foram processados pelo endpoint público.';

commit;
