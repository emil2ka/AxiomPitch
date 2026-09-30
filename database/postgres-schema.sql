-- Future Supabase/PostgreSQL schema; applying this is a separate deployment step.
-- Local profile UUIDs remain stable. owner_user_id is supplied after real Auth login.
begin;
create table public.profiles (
  id uuid primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  email text not null default '',
  created_at timestamptz not null default now(),
  learned_at timestamptz,
  updated_at timestamptz not null default now(),
  preferences jsonb not null default '{}'::jsonb,
  workspace jsonb
);
create index profiles_by_owner on public.profiles(owner_user_id);
create table public.presentations (
  id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  page_count integer not null check (page_count between 1 and 60),
  size bigint not null check (size > 0 and size <= 31457280),
  notes jsonb not null default '[]'::jsonb,
  storage_key text not null unique,
  created_at timestamptz not null default now()
);
create index presentations_by_profile on public.presentations(profile_id, created_at desc);
create table public.sessions (
  id text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  presentation_id uuid references public.presentations(id) on delete set null,
  mode text not null check (mode in ('rehearsal', 'live')),
  started_at timestamptz not null,
  duration double precision not null check (duration >= 0),
  result jsonb not null,
  saved_at timestamptz not null default now()
);
create index sessions_by_profile on public.sessions(profile_id, started_at desc);
alter table public.profiles enable row level security;
alter table public.presentations enable row level security;
alter table public.sessions enable row level security;
create policy profiles_own on public.profiles for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy presentations_own on public.presentations for all to authenticated
  using (exists(select 1 from public.profiles p where p.id = profile_id and p.owner_user_id = (select auth.uid())))
  with check (exists(select 1 from public.profiles p where p.id = profile_id and p.owner_user_id = (select auth.uid())));
create policy sessions_own on public.sessions for all to authenticated
  using (exists(select 1 from public.profiles p where p.id = profile_id and p.owner_user_id = (select auth.uid())))
  with check (
    exists(select 1 from public.profiles p where p.id = profile_id and p.owner_user_id = (select auth.uid()))
    and (presentation_id is null or exists(select 1 from public.presentations d where d.id = presentation_id and d.profile_id = sessions.profile_id))
  );
grant select, insert, update, delete on public.profiles, public.presentations, public.sessions to authenticated;
commit;
-- Create a PRIVATE Storage bucket for PDFs separately; enforce matching owner policies.
-- The local X-Axiom-Profile header must never act as cloud authentication.
