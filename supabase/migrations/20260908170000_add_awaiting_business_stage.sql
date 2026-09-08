-- Esta alteração precisa ser confirmada antes de qualquer uso da nova fase.
-- Por isso ela fica isolada em uma migration anterior à do funil.

alter type public.business_stage
  add value if not exists 'aguardando' before 'prospeccao';
