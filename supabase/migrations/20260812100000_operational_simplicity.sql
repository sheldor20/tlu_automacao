-- Central operacional, modelos reutilizáveis e automação entre departamentos.
-- Execute depois de 20260811220000_rentals_and_department_access.sql.
-- IMPORTANTE: no SQL Editor do Supabase, selecione a role `postgres`.

begin;

do $$
begin
  if current_user <> 'postgres' and not pg_has_role(current_user, 'postgres', 'member') then
    raise exception using
      errcode = '42501',
      message = 'migration_requires_postgres_role',
      hint = 'No SQL Editor do Supabase, altere Role de authenticated para postgres e execute novamente.';
  end if;
end;
$$;

-- A obra passa a preservar o projeto e o responsável que deram origem ao registro.
alter table public.constructions
  add column if not exists source_project_id uuid references public.projects(id) on delete set null,
  add column if not exists responsible_user_id uuid references public.profiles(user_id) on delete set null,
  add column if not exists responsible_name text,
  add column if not exists responsible_email text;

create index if not exists constructions_source_project_idx on public.constructions(source_project_id);
create index if not exists constructions_responsible_idx on public.constructions(responsible_user_id);

create or replace function public.sync_construction_responsible_from_profile()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.responsible_user_id is null then
    new.responsible_name := null;
    new.responsible_email := null;
    return new;
  end if;

  select
    coalesce(nullif(btrim(profile.full_name), ''), split_part(profile.email, '@', 1)),
    lower(profile.email)
  into new.responsible_name, new.responsible_email
  from public.profiles profile
  where profile.user_id = new.responsible_user_id
    and profile.active
    and profile.email is not null;

  if not found then
    raise exception using message = 'profile_not_available';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_construction_responsible_before_write on public.constructions;
create trigger sync_construction_responsible_before_write
before insert or update of responsible_user_id, responsible_name, responsible_email on public.constructions
for each row execute function public.sync_construction_responsible_from_profile();

-- Trocas rápidas de responsável também atualizam a lista de envolvidos.
drop trigger if exists add_owner_member_after_project_insert on public.projects;
create trigger add_owner_member_after_project_write
after insert or update of owner_user_id on public.projects
for each row execute function public.add_project_owner_as_member();

-- Modelos de obra persistidos no banco. A estrutura permite adicionar novos
-- modelos depois sem alterar o código da aplicação.
create table public.construction_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 2 and 140),
  type public.construction_type not null,
  description text,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.construction_template_macro_stages (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.construction_templates(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  weight_percent numeric(5,2) not null check (weight_percent between 0 and 100),
  position integer not null default 0,
  unique (template_id, name)
);

create table public.construction_template_micro_stages (
  id uuid primary key default gen_random_uuid(),
  template_macro_id uuid not null references public.construction_template_macro_stages(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 140),
  description text,
  position integer not null default 0,
  unique (template_macro_id, name)
);

-- Modelos de projeto com tarefas e prazos relativos ao início.
create table public.project_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 2 and 140),
  description text,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_template_tasks (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.project_templates(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 220),
  description text,
  due_offset_days integer not null default 0 check (due_offset_days between 0 and 3650),
  status public.task_status not null default 'a_fazer',
  position integer not null default 0,
  assignee_user_id uuid references public.profiles(user_id) on delete set null
);

create index construction_template_macro_idx on public.construction_template_macro_stages(template_id, position);
create index construction_template_micro_idx on public.construction_template_micro_stages(template_macro_id, position);
create index project_template_tasks_idx on public.project_template_tasks(template_id, position);

create trigger set_construction_templates_updated_at
before update on public.construction_templates
for each row execute function public.set_updated_at();

create trigger set_project_templates_updated_at
before update on public.project_templates
for each row execute function public.set_updated_at();

-- Modelos iniciais Terra Lótus.
insert into public.construction_templates (name, type, description, created_by)
values
  ('Loteamento padrão', 'loteamento', 'Estrutura base da viabilidade à entrega de um loteamento.', null),
  ('Construção padrão', 'construcao', 'Estrutura base da fundação à entrega de uma construção.', null)
on conflict (name) do nothing;

insert into public.construction_template_macro_stages (template_id, name, description, weight_percent, position)
select template.id, stage.name, stage.description, stage.weight_percent, stage.position
from public.construction_templates template
cross join lateral (
  values
    ('Loteamento padrão', 'Planejamento e licenças', 'Projetos executivos, licenças e mobilização.', 10::numeric, 0),
    ('Loteamento padrão', 'Terraplenagem', 'Preparação do terreno e movimentação de terra.', 20::numeric, 1),
    ('Loteamento padrão', 'Infraestrutura', 'Redes de drenagem, água, esgoto e energia.', 35::numeric, 2),
    ('Loteamento padrão', 'Pavimentação', 'Base, pavimento e sinalização.', 25::numeric, 3),
    ('Loteamento padrão', 'Entrega', 'Paisagismo, vistoria e entrega final.', 10::numeric, 4),
    ('Construção padrão', 'Planejamento', 'Projetos executivos, licenças e mobilização.', 10::numeric, 0),
    ('Construção padrão', 'Fundações', 'Escavação, contenções e fundações.', 20::numeric, 1),
    ('Construção padrão', 'Estrutura', 'Estrutura principal da edificação.', 25::numeric, 2),
    ('Construção padrão', 'Instalações', 'Instalações elétricas, hidráulicas e complementares.', 20::numeric, 3),
    ('Construção padrão', 'Acabamentos', 'Revestimentos, esquadrias e acabamentos finais.', 20::numeric, 4),
    ('Construção padrão', 'Entrega', 'Testes, vistoria e entrega final.', 5::numeric, 5)
) as stage(template_name, name, description, weight_percent, position)
where template.name = stage.template_name
on conflict (template_id, name) do nothing;

insert into public.construction_template_micro_stages (template_macro_id, name, description, position)
select macro.id, micro.name, micro.description, micro.position
from public.construction_template_macro_stages macro
join public.construction_templates template on template.id = macro.template_id
join lateral (
  values
    ('Loteamento padrão', 'Planejamento e licenças', 'Projetos executivos', 'Consolidar e aprovar os projetos executivos.', 0),
    ('Loteamento padrão', 'Planejamento e licenças', 'Licenças e mobilização', 'Liberar licenças e preparar o canteiro.', 1),
    ('Loteamento padrão', 'Terraplenagem', 'Limpeza do terreno', 'Executar limpeza e preparação inicial.', 0),
    ('Loteamento padrão', 'Terraplenagem', 'Movimentação de terra', 'Executar cortes, aterros e compactação.', 1),
    ('Loteamento padrão', 'Infraestrutura', 'Drenagem', 'Executar a rede de drenagem pluvial.', 0),
    ('Loteamento padrão', 'Infraestrutura', 'Água e esgoto', 'Executar redes de abastecimento e esgotamento.', 1),
    ('Loteamento padrão', 'Infraestrutura', 'Energia e iluminação', 'Executar redes elétricas e iluminação pública.', 2),
    ('Loteamento padrão', 'Pavimentação', 'Base e sub-base', 'Preparar base e sub-base das vias.', 0),
    ('Loteamento padrão', 'Pavimentação', 'Pavimentação e sinalização', 'Executar pavimento, meio-fio e sinalização.', 1),
    ('Loteamento padrão', 'Entrega', 'Paisagismo', 'Executar paisagismo e urbanização final.', 0),
    ('Loteamento padrão', 'Entrega', 'Vistoria e entrega', 'Concluir correções, vistoria e entrega.', 1),
    ('Construção padrão', 'Planejamento', 'Projetos e licenças', 'Consolidar projetos, licenças e plano executivo.', 0),
    ('Construção padrão', 'Planejamento', 'Mobilização', 'Preparar canteiro, equipe e segurança.', 1),
    ('Construção padrão', 'Fundações', 'Escavação e contenções', 'Executar escavações e contenções previstas.', 0),
    ('Construção padrão', 'Fundações', 'Elementos de fundação', 'Executar fundações e blocos.', 1),
    ('Construção padrão', 'Estrutura', 'Estrutura principal', 'Executar pilares, vigas e lajes.', 0),
    ('Construção padrão', 'Estrutura', 'Vedações', 'Executar alvenarias e fechamentos.', 1),
    ('Construção padrão', 'Instalações', 'Instalações hidráulicas', 'Executar redes hidráulicas e sanitárias.', 0),
    ('Construção padrão', 'Instalações', 'Instalações elétricas', 'Executar redes elétricas e complementares.', 1),
    ('Construção padrão', 'Acabamentos', 'Revestimentos', 'Executar pisos, paredes e forros.', 0),
    ('Construção padrão', 'Acabamentos', 'Esquadrias e pintura', 'Instalar esquadrias e concluir pintura.', 1),
    ('Construção padrão', 'Entrega', 'Testes e comissionamento', 'Testar instalações e sistemas.', 0),
    ('Construção padrão', 'Entrega', 'Vistoria e entrega', 'Concluir pendências, vistoria e entrega.', 1)
) as micro(template_name, macro_name, name, description, position)
  on template.name = micro.template_name and macro.name = micro.macro_name
on conflict (template_macro_id, name) do nothing;

insert into public.project_templates (name, description, created_by)
values ('Projeto padrão', 'Tarefas essenciais de planejamento, execução e encerramento.', null)
on conflict (name) do nothing;

insert into public.project_template_tasks (template_id, title, description, due_offset_days, position)
select template.id, task.title, task.description, task.due_offset_days, task.position
from public.project_templates template
cross join lateral (
  values
    ('Definir escopo e resultado', 'Confirmar objetivo, entregas e critério de sucesso.', 0, 0),
    ('Planejar responsáveis e prazos', 'Distribuir responsabilidades e validar o cronograma.', 3, 1),
    ('Realizar reunião de início', 'Alinhar envolvidos, decisões e próximos passos.', 1, 2),
    ('Executar acompanhamento', 'Registrar status, riscos e decisões da execução.', 7, 3),
    ('Validar entregas', 'Revisar resultados com os envolvidos.', 14, 4),
    ('Encerrar e registrar aprendizados', 'Consolidar arquivos, comentários e aprendizados.', 15, 5)
) as task(title, description, due_offset_days, position)
where template.name = 'Projeto padrão'
  and not exists (
    select 1 from public.project_template_tasks existing
    where existing.template_id = template.id and existing.title = task.title
  );

-- Criação transacional: evita obras ou projetos pela metade quando um modelo falha.
create or replace function public.create_construction_from_template(
  p_name text,
  p_type public.construction_type,
  p_start_date date,
  p_template_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
  macro_row record;
  created_macro_id uuid;
begin
  if not public.has_department_access('obras') then
    raise exception using message = 'department_access_required';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 140 then
    raise exception using message = 'invalid_construction_name';
  end if;
  if p_template_id is not null and not exists (
    select 1 from public.construction_templates template
    where template.id = p_template_id and template.is_active and template.type = p_type
  ) then
    raise exception using message = 'construction_template_not_available';
  end if;

  insert into public.constructions (name, type, start_date, planned_budget, status, created_by)
  values (btrim(p_name), p_type, coalesce(p_start_date, current_date), 0, 'planejamento', auth.uid())
  returning id into created_id;

  if p_template_id is not null then
    for macro_row in
      select * from public.construction_template_macro_stages
      where template_id = p_template_id order by position
    loop
      insert into public.construction_macro_stages (
        construction_id, name, description, weight_percent, position, created_by
      ) values (
        created_id, macro_row.name, macro_row.description, macro_row.weight_percent, macro_row.position, auth.uid()
      ) returning id into created_macro_id;

      insert into public.construction_micro_stages (
        macro_stage_id, name, description, progress_percent, position, supplies, created_by
      )
      select created_macro_id, micro.name, micro.description, 0, micro.position, '[]'::jsonb, auth.uid()
      from public.construction_template_micro_stages micro
      where micro.template_macro_id = macro_row.id
      order by micro.position;
    end loop;
  end if;
  return created_id;
end;
$$;

create or replace function public.create_project_from_template(
  p_name text,
  p_owner_user_id uuid,
  p_start_date date,
  p_template_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  if not public.has_department_access('projetos') then
    raise exception using message = 'department_access_required';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 140 then
    raise exception using message = 'invalid_project_name';
  end if;
  if p_template_id is not null and not exists (
    select 1 from public.project_templates template
    where template.id = p_template_id and template.is_active
  ) then
    raise exception using message = 'project_template_not_available';
  end if;

  insert into public.projects (
    name, start_date, owner_user_id, owner_name, owner_email, objective, status, created_by
  ) values (
    btrim(p_name), coalesce(p_start_date, current_date), p_owner_user_id,
    'Responsável', 'responsavel@temp.invalid', 'A definir', 'ativo', auth.uid()
  ) returning id into created_id;

  if p_template_id is not null then
    insert into public.project_tasks (
      project_id, title, description, assignee_user_id, assignee_name, assignee_email,
      due_date, status, position, created_by
    )
    select
      created_id, task.title, task.description,
      coalesce(task.assignee_user_id, p_owner_user_id), 'Responsável', 'responsavel@temp.invalid',
      coalesce(p_start_date, current_date) + task.due_offset_days,
      task.status, task.position, auth.uid()
    from public.project_template_tasks task
    where task.template_id = p_template_id
    order by task.position;
  end if;
  return created_id;
end;
$$;

create or replace function public.apply_construction_template(
  p_construction_id uuid,
  p_template_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  macro_row record;
  created_macro_id uuid;
  construction_type public.construction_type;
begin
  if not public.has_department_access('obras') then
    raise exception using message = 'department_access_required';
  end if;
  select construction.type into construction_type
  from public.constructions construction
  where construction.id = p_construction_id;
  if not found then
    raise exception using message = 'construction_not_available';
  end if;
  if exists (select 1 from public.construction_macro_stages where construction_id = p_construction_id) then
    raise exception using message = 'construction_already_structured';
  end if;
  if not exists (
    select 1 from public.construction_templates template
    where template.id = p_template_id and template.is_active and template.type = construction_type
  ) then
    raise exception using message = 'construction_template_not_available';
  end if;

  for macro_row in
    select * from public.construction_template_macro_stages
    where template_id = p_template_id order by position
  loop
    insert into public.construction_macro_stages (
      construction_id, name, description, weight_percent, position, created_by
    ) values (
      p_construction_id, macro_row.name, macro_row.description, macro_row.weight_percent, macro_row.position, auth.uid()
    ) returning id into created_macro_id;

    insert into public.construction_micro_stages (
      macro_stage_id, name, description, progress_percent, position, supplies, created_by
    )
    select created_macro_id, micro.name, micro.description, 0, micro.position, '[]'::jsonb, auth.uid()
    from public.construction_template_micro_stages micro
    where micro.template_macro_id = macro_row.id
    order by micro.position;
  end loop;
end;
$$;

-- A passagem para Obras reaproveita nome, localização, datas, responsável e o
-- vínculo com os documentos do projeto, sem duplicar arquivos no storage.
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
    values (new.id, new.stage, auth.uid());

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
        'Obra criada automaticamente a partir do funil de Novos Negócios.', auth.uid()
      from public.projects project
      where project.id = new.project_id
      on conflict (source_business_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

-- Inclui o responsável no seletor e nos filtros de Novos Negócios.
drop function if exists public.business_project_options();
create function public.business_project_options()
returns table (
  id uuid,
  name text,
  status public.project_status,
  archived_at timestamptz,
  owner_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select project.id, project.name, project.status, project.archived_at, project.owner_name
  from public.projects project
  where public.has_department_access('novos-negocios')
    and project.archived_at is null
    and project.status in ('ativo', 'concluido')
  order by project.name;
$$;

revoke all on function public.business_project_options() from public;
grant execute on function public.business_project_options() to authenticated;

-- Arquivos do projeto-fonte ficam disponíveis na aba Arquivos da obra sem cópia.
create or replace function public.construction_source_files(p_construction_id uuid)
returns table (
  id uuid,
  file_path text,
  file_name text,
  mime_type text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select file.id, file.file_path, file.file_name, file.mime_type, file.created_at
  from public.constructions construction
  join public.project_files file on file.project_id = construction.source_project_id
  where construction.id = p_construction_id
    and public.has_department_access('obras')
  order by file.created_at desc;
$$;

create or replace function public.can_access_project_file_from_construction(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_department_access('obras') and exists (
    select 1
    from public.project_files file
    join public.constructions construction on construction.source_project_id = file.project_id
    where file.file_path = p_path
  );
$$;

revoke all on function public.create_construction_from_template(text, public.construction_type, date, uuid) from public;
revoke all on function public.create_project_from_template(text, uuid, date, uuid) from public;
revoke all on function public.apply_construction_template(uuid, uuid) from public;
revoke all on function public.construction_source_files(uuid) from public;
revoke all on function public.can_access_project_file_from_construction(text) from public;
grant execute on function public.create_construction_from_template(text, public.construction_type, date, uuid) to authenticated;
grant execute on function public.create_project_from_template(text, uuid, date, uuid) to authenticated;
grant execute on function public.apply_construction_template(uuid, uuid) to authenticated;
grant execute on function public.construction_source_files(uuid) to authenticated;
grant execute on function public.can_access_project_file_from_construction(text) to authenticated;

-- Resumos operacionais para filtros e para a página Hoje.
drop view if exists public.construction_progress_summary;
create view public.construction_progress_summary
with (security_invoker = true)
as
with stage_data as (
  select
    m.construction_id,
    sum(m.weight_percent) as stage_weight_total,
    sum((m.weight_percent / 100.0) * m.progress_percent) as progress_percent
  from public.construction_macro_stage_progress m
  group by m.construction_id
), budget_data as (
  select
    b.construction_id,
    sum(b.realized_amount) as realized_total,
    sum(b.realized_amount) filter (
      where b.reference_month = date_trunc('month', current_date)::date
    ) as realized_current_month
  from public.construction_budgets b
  group by b.construction_id
), activity_data as (
  select update.construction_id, max(update.created_at) as last_activity_at
  from public.construction_updates update
  group by update.construction_id
)
select
  c.*,
  coalesce(s.progress_percent, 0) as progress_percent,
  coalesce(s.stage_weight_total, 0) as stage_weight_total,
  coalesce(b.realized_total, 0) as realized_total,
  coalesce(b.realized_current_month, 0) as realized_current_month,
  coalesce(a.last_activity_at, c.created_at) as last_activity_at
from public.constructions c
left join stage_data s on s.construction_id = c.id
left join budget_data b on b.construction_id = c.id
left join activity_data a on a.construction_id = c.id;

create or replace view public.business_operational_summary
with (security_invoker = true)
as
select
  business.*,
  history.entered_at as current_stage_entered_at,
  floor(extract(epoch from (now() - history.entered_at)) / 86400)::integer as days_in_stage
from public.businesses business
left join public.business_stage_history history
  on history.business_id = business.id and history.exited_at is null;

alter table public.construction_templates enable row level security;
alter table public.construction_template_macro_stages enable row level security;
alter table public.construction_template_micro_stages enable row level security;
alter table public.project_templates enable row level security;
alter table public.project_template_tasks enable row level security;

create policy construction_templates_department_access on public.construction_templates
for select to authenticated using (public.has_department_access('obras'));
create policy construction_template_macro_department_access on public.construction_template_macro_stages
for select to authenticated using (public.has_department_access('obras'));
create policy construction_template_micro_department_access on public.construction_template_micro_stages
for select to authenticated using (public.has_department_access('obras'));
create policy project_templates_department_access on public.project_templates
for select to authenticated using (public.has_department_access('projetos'));
create policy project_template_tasks_department_access on public.project_template_tasks
for select to authenticated using (public.has_department_access('projetos'));

grant select on
  public.construction_templates,
  public.construction_template_macro_stages,
  public.construction_template_micro_stages,
  public.project_templates,
  public.project_template_tasks,
  public.construction_progress_summary,
  public.business_operational_summary
to authenticated;

drop policy if exists project_files_storage_read on storage.objects;
create policy project_files_storage_read on storage.objects
for select to authenticated using (
  bucket_id = 'project-files'
  and (
    public.has_department_access('projetos')
    or public.can_access_project_file_from_construction(name)
  )
);

commit;
