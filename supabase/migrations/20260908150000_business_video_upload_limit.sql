begin;

update storage.buckets
set file_size_limit = 2147483648
where id = 'business-files';

commit;
