begin;
alter table public.accountability_dispatches
 add column pdf_path text,
 add column excel_path text,
 add column pdf_sha256 text,
 add column excel_sha256 text,
 add column source_revision text,
 add column generated_at timestamptz;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('accountability-books','accountability-books',false,20000000,array['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create policy accountability_books_read on storage.objects for select to authenticated
using(bucket_id='accountability-books' and public.has_department_access('prestacao-contas'));
commit;
