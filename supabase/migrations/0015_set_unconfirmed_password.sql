-- Signup sets the newest password on an account that is still unverified (see apps/backend
-- routes/auth.ts). Checking "still unverified" and writing the password must be one statement:
-- otherwise the owner could verify the account in between and a stranger's signup would then
-- overwrite the verified account's password. Returns false, and changes nothing, once the email
-- is confirmed. GoTrue stores bcrypt hashes, which pgcrypto's crypt(.., gen_salt('bf')) makes.
--
-- The same statement voids every link already sent (confirmation and recovery tokens, in
-- auth.users and in auth.one_time_tokens), so no earlier email can verify the account with the
-- password written here; the backend then emails a fresh link.
-- Called only by apps/backend with the service role.
create or replace function public.set_unconfirmed_password(p_user_id uuid, p_password text)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         confirmation_token = '',
         recovery_token = '',
         updated_at = now()
   where id = p_user_id
     and email_confirmed_at is null;
  if not found then
    return false;
  end if;

  delete from auth.one_time_tokens
   where user_id = p_user_id
     and token_type in ('confirmation_token', 'recovery_token');
  return true;
end;
$$;

revoke execute on function public.set_unconfirmed_password(uuid, text) from public, anon, authenticated;
grant execute on function public.set_unconfirmed_password(uuid, text) to service_role;
