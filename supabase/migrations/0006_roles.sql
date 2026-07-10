-- Role-based access control (Supabase-recommended pattern): a user_roles table
-- plus a SECURITY DEFINER has_role() helper. Roles live in the DB (not baked into
-- the JWT), so grant/revoke takes effect immediately. Booking RLS policies and the
-- deliver-booking edge function authorize staff via has_role() (wired in a later
-- migration / the feature build). This migration only establishes the role model.

create type app_role as enum ('staff', 'admin');

create table user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table user_roles enable row level security;

-- SECURITY DEFINER + empty search_path: runs as the function owner so RLS policies
-- can call it without the caller holding a direct grant on user_roles, and so a
-- policy ON user_roles can't recurse back through this function. Fully-qualify names.
create function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = _user_id and ur.role = _role
  );
$$;

grant execute on function public.has_role(uuid, app_role) to authenticated;

-- Clients may read their own role rows (e.g. to toggle staff UI); role writes are
-- service-role/admin only — no insert/update/delete grant to authenticated.
grant select on user_roles to authenticated;
create policy "read own roles" on user_roles
  for select to authenticated using (user_id = auth.uid());
