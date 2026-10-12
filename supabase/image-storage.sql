begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('ipos-images','ipos-images',false,5242880,array['image/png','image/jpeg','image/webp']);
create policy ipos_image_read on storage.objects for select to authenticated using(bucket_id='ipos-images' and (storage.foldername(name))[2] in ('logos','products') and exists(select 1 from public.company_users u where u.user_id=auth.uid() and u.active and u.company_id::text=(storage.foldername(name))[1]));
create policy ipos_image_upload on storage.objects for insert to authenticated with check(bucket_id='ipos-images' and (storage.foldername(name))[3]=auth.uid()::text and exists(select 1 from public.company_users u where u.user_id=auth.uid() and u.active and u.company_id::text=(storage.foldername(name))[1] and (((storage.foldername(name))[2]='logos' and u.role='director') or ((storage.foldername(name))[2]='products' and u.role in ('director','supervisor')))));
commit;
