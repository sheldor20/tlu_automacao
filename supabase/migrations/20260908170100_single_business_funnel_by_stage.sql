-- Um único funil de Novos Negócios, particionado nos menus pela fase atual.
-- A carga ao final usa o status individual das 21 áreas da planilha recebida.

begin;

create or replace function public.business_portfolio_section_for_stage(p_stage public.business_stage)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when p_stage = 'aguardando' then 'landing_bank'
    when p_stage in ('prospeccao', 'viabilidade', 'contrato', 'viabilidade_mercadologica') then 'prospeccao'
    else 'esteira_negocios'
  end;
$$;

create or replace function public.sync_business_portfolio_from_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.portfolio_section := public.business_portfolio_section_for_stage(new.stage);
  return new;
end;
$$;

drop trigger if exists sync_business_portfolio_from_stage on public.businesses;
create trigger sync_business_portfolio_from_stage
before insert or update of stage, portfolio_section on public.businesses
for each row execute function public.sync_business_portfolio_from_stage();

-- Permite executar a carga como postgres sem perder o autor exigido no histórico.
create or replace function public.track_business_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.business_stage_history (business_id, stage, entered_at, changed_by)
    values (new.id, new.stage, new.created_at, new.created_by);
  elsif new.stage is distinct from old.stage then
    update public.business_stage_history
      set exited_at = now()
      where business_id = new.id and exited_at is null;
    insert into public.business_stage_history (business_id, stage, changed_by)
    values (new.id, new.stage, coalesce(auth.uid(), new.created_by));

    if new.stage = 'obra' then
      insert into public.constructions (
        source_business_id, source_project_id, responsible_user_id,
        name, type, start_date, expected_end_date, address, planned_budget, status,
        notes, created_by
      )
      select
        new.id, new.project_id, project.owner_user_id,
        new.name, 'loteamento', new.start_date, project.end_date,
        concat_ws(', ', new.address, new.city, new.state), 0, 'planejamento',
        'Obra criada automaticamente a partir do funil de Novos Negócios.',
        coalesce(auth.uid(), new.created_by)
      from public.projects project
      where project.id = new.project_id
      on conflict (source_business_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

update public.businesses business
set portfolio_section = public.business_portfolio_section_for_stage(business.stage)
where business.portfolio_section is distinct from public.business_portfolio_section_for_stage(business.stage);

create or replace function public.prevent_business_delete_outside_prospecting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.business_portfolio_section_for_stage(old.stage) <> 'prospeccao' then
    raise exception 'business_delete_only_allowed_in_prospeccao';
  end if;
  return old;
end;
$$;

do $$
declare
  import_row record;
  normalized_source text;
  match_count integer;
  unmatched_names text;
begin
  for import_row in
    select *
    from (values
      ('Rio Verde', 'prospeccao'),
      ('Mineiros (Residencial Araguaia - Etapa III) - Parceria', 'esteira_negocios'),
      ('Anápolis (Antonio Fernandes)', 'prospeccao'),
      ('Jaciara (Vale das Águas II) - Parceria', 'esteira_negocios'),
      ('Itumbiara (Senhor Sebastião) - Parceria', 'esteira_negocios'),
      ('Itumbiara (Fazenda Pombas) - Lírios', 'prospeccao'),
      ('Anápolis (Fazenda Formiga)', 'landing_bank'),
      ('Anápolis (Área dos padres) - Lírios', 'landing_bank'),
      ('Anápolis (Fazenda Extrema - Maria da Luz) - Lírios', 'landing_bank'),
      ('Rondonópolis (Remanescente) - Lírios', 'prospeccao'),
      ('Palmeiras de Goiás (Fazenda Boa Esperança) - Parceria', 'landing_bank'),
      ('Anápolis (Primavera - Fazenda Sozinha - Paulo Couto) - Lírios', 'landing_bank'),
      ('Anápolis (Fazenda Extrema - Jader)', 'landing_bank'),
      ('Senador Canedo (Fazenda Retiro) - Parceria', 'prospeccao'),
      ('Rio Verde (São Tomas)', 'prospeccao'),
      ('Jataí Etapa 02', 'prospeccao'),
      ('Rio Verde - Etapa 02', 'prospeccao'),
      ('Jataí', 'prospeccao'),
      ('Anápolis (Colorado) - Parceria', 'prospeccao'),
      ('Mineiros (Residencial Araguaia - Etapa II) - Parceria', 'esteira_negocios'),
      ('Anápolis (Boa Vista) - Parceria', 'esteira_negocios')
    ) as status(source_name, target_section)
  loop
    normalized_source := regexp_replace(
      translate(lower(btrim(import_row.source_name)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
      '[^a-z0-9]+',
      '',
      'g'
    );

    select count(*)
    into match_count
    from public.businesses business
    where regexp_replace(
      translate(lower(btrim(business.name)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
      '[^a-z0-9]+',
      '',
      'g'
    ) = normalized_source;

    if match_count > 1 then
      raise exception 'Nome duplicado impede a carga da planilha: %', import_row.source_name;
    elsif match_count = 0 then
      unmatched_names := concat_ws(', ', unmatched_names, import_row.source_name);
    else
      -- Preserva a fase detalhada quando ela já pertence ao trecho indicado.
      -- Em uma incompatibilidade, move somente para a primeira fase do trecho.
      update public.businesses business
      set stage = case import_row.target_section
        when 'landing_bank' then 'aguardando'::public.business_stage
        when 'prospeccao' then case
          when business.stage in ('prospeccao', 'viabilidade', 'contrato', 'viabilidade_mercadologica') then business.stage
          else 'prospeccao'::public.business_stage
        end
        else case
          when business.stage in ('masterplan', 'aprovacao', 'obra') then business.stage
          else 'masterplan'::public.business_stage
        end
      end
      where regexp_replace(
        translate(lower(btrim(business.name)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
        '[^a-z0-9]+',
        '',
        'g'
      ) = normalized_source;
    end if;
  end loop;

  if unmatched_names is not null then
    raise warning 'Áreas da planilha não encontradas no cadastro e mantidas sem alteração: %', unmatched_names;
  end if;
end;
$$;

comment on column public.businesses.portfolio_section is
  'Trecho derivado da fase do funil; mantido por compatibilidade e sincronizado automaticamente.';
comment on function public.business_portfolio_section_for_stage(public.business_stage) is
  'Mapeia Aguardando para Landing Bank, as quatro fases comerciais para Prospecção e as três fases finais para Esteira.';

commit;
