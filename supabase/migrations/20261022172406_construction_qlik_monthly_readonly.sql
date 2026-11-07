begin;

-- Additive only: keep every existing principal link and every legacy amount.
-- Additional units belong to this construction, never to sibling constructions.
alter table public.constructions add column qlik_additional_work_keys text[] not null default '{}';

create function public.validate_construction_qlik_units() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare k text; inherited text;
begin
  -- Preserve the existing inheritance contract. The original business triggers
  -- still own propagation of the principal key.
  if new.source_business_id is not null then
    select qlik_work_key into inherited from public.businesses where id=new.source_business_id;
    -- A caller without access to the business can keep the inherited key, but
    -- cannot change it via this table (the business propagation uses its owner).
    if not found then
      if tg_op='INSERT' or new.source_business_id is distinct from old.source_business_id
        or new.qlik_work_key is distinct from old.qlik_work_key then
        raise exception 'construction_qlik_inherited_link';
      end if;
    elsif new.qlik_work_key is distinct from inherited then
      raise exception 'construction_qlik_inherited_link';
    end if;
  end if;
  -- On an external change of principal/origin, discard the old supplementary
  -- selection so unrelated units cannot silently follow the new principal.
  if tg_op='UPDATE' and
    (new.source_business_id is distinct from old.source_business_id or
      (new.source_business_id is not null and new.qlik_work_key is distinct from old.qlik_work_key))
    and new.qlik_additional_work_keys is not distinct from old.qlik_additional_work_keys then
    new.qlik_additional_work_keys := '{}';
  end if;
  if new.qlik_work_key is null and cardinality(new.qlik_additional_work_keys)>0 then
    raise exception 'construction_qlik_primary_required';
  end if;
  if coalesce(array_ndims(new.qlik_additional_work_keys),1)<>1 or
    cardinality(new.qlik_additional_work_keys)>49 or
    cardinality(new.qlik_additional_work_keys)<>(select count(distinct x) from unnest(new.qlik_additional_work_keys) x) or
    new.qlik_work_key=any(new.qlik_additional_work_keys) then
    raise exception 'construction_qlik_units_invalid';
  end if;
  foreach k in array new.qlik_additional_work_keys loop
    if not exists(select 1 from public.qlik_works where key=k and active) then
      raise exception 'construction_qlik_unit_unavailable';
    end if;
  end loop;
  return new;
end $$;
-- Runs after construction_qlik_work_before, which supplies the inherited key.
create trigger construction_zz_qlik_units_before before insert or update of
  qlik_work_key,qlik_additional_work_keys,source_business_id on public.constructions
  for each row execute function public.validate_construction_qlik_units();

-- Legacy financial tables remain readable. Block old browser bundles and direct
-- Data API writes without modifying grants or RLS or deleting historical rows.
create function public.reject_manual_construction_finance() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'construction_finance_read_only: valores manuais são legado; use a leitura Qlik'
    using errcode='23514';
end $$;
create trigger construction_budgets_read_only before insert or update or delete on public.construction_budgets
  for each row execute function public.reject_manual_construction_finance();
create trigger construction_commitments_read_only before insert or update or delete on public.construction_commitments
  for each row execute function public.reject_manual_construction_finance();
create trigger construction_estimates_read_only before insert or update or delete on public.construction_cost_estimates
  for each row execute function public.reject_manual_construction_finance();
create trigger construction_stage_finances_read_only before insert or update or delete on public.construction_stage_finances
  for each row execute function public.reject_manual_construction_finance();
commit;
