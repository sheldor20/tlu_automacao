begin;
-- Store bytes in Postgres; thread history requests metadata only.
create table public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 255),
  mime_type text not null check (char_length(mime_type) between 1 and 150),
  content bytea not null check (octet_length(content) between 1 and 5242880),
  size integer generated always as (octet_length(content)) stored
);
create index chat_attachments_message on public.chat_attachments(message_id);
alter table public.chat_attachments enable row level security;
revoke all on public.chat_attachments from public,anon,authenticated;
grant select on public.chat_attachments to authenticated;
create policy chat_attachments_read on public.chat_attachments for select to authenticated
using (exists(select 1 from public.chat_messages m where m.id=message_id and chat_private.is_member(m.conversation_id)));

create function chat_private.send_with_attachments(p_conversation uuid,p_body text,p_files jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_message uuid; v_file jsonb; v_content bytea; v_total integer := 0;
begin
  if not chat_private.is_member(p_conversation) then
    raise exception 'Conversa indisponível.';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception 'Lista de anexos inválida.';
  end if;
  if jsonb_array_length(p_files) not between 1 and 5 then
    raise exception 'Selecione de 1 a 5 arquivos.';
  end if;
  if char_length(coalesce(p_body,'')) > 4000 then
    raise exception 'Mensagem deve ter até 4000 caracteres.';
  end if;
  insert into public.chat_messages(conversation_id,body)
    values(p_conversation,coalesce(nullif(btrim(p_body),''),'📎 Anexos')) returning id into v_message;
  for v_file in select value from jsonb_array_elements(p_files) loop
    if char_length(v_file->>'data') > 6990508 then
      raise exception 'Cada arquivo deve ter até 5 MB.';
    end if;
    v_content := decode(v_file->>'data','base64');
    v_total := v_total + octet_length(v_content);
    if v_total > 10485760 then raise exception 'Os anexos devem somar até 10 MB.'; end if;
    insert into public.chat_attachments(message_id,name,mime_type,content)
      values(v_message,v_file->>'name',v_file->>'mime_type',v_content);
  end loop;
  return v_message;
end $$;
revoke all on function chat_private.send_with_attachments(uuid,text,jsonb) from public,anon;
grant execute on function chat_private.send_with_attachments(uuid,text,jsonb) to authenticated;
create function public.send_chat_attachments(p_conversation uuid,p_body text,p_files jsonb)
returns uuid language sql security invoker set search_path='' as $$
  select chat_private.send_with_attachments(p_conversation,p_body,p_files)
$$;
revoke all on function public.send_chat_attachments(uuid,text,jsonb) from public,anon;
grant execute on function public.send_chat_attachments(uuid,text,jsonb) to authenticated;
create function public.download_chat_attachment(p_id uuid)
returns table(name text,mime_type text,data text)
language sql stable security invoker set search_path='' as $$
  select a.name,a.mime_type,encode(a.content,'base64') from public.chat_attachments a where a.id=p_id
$$;
revoke all on function public.download_chat_attachment(uuid) from public,anon;
grant execute on function public.download_chat_attachment(uuid) to authenticated;
commit;
