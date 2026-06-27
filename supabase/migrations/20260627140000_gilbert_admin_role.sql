-- Ensure Gilbert's primary account has admin moderation privileges.
update public.profiles
set role = 'admin'
where lower(email) = 'gilbertandersonwork@gmail.com';
