-- Personal CRM Team Edition — run in Supabase SQL Editor

create extension if not exists "pgcrypto";

-- Teams
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  owner_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Profiles (one per auth user)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  team_id uuid references teams(id),
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

-- CRM entities (scoped to owner user + team)
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  email text default '',
  phone text default '',
  company text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  title text not null,
  amount numeric default 0,
  stage text not null default 'Lead' check (stage in ('Lead', 'Qualified', 'Proposal', 'Won', 'Lost')),
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,
  title text not null,
  due_date date,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contact activity notes (timeline)
create table if not exists contact_notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- Activity log for team leaderboard
create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  action text not null,
  entity_type text,
  entity_id uuid,
  meta jsonb default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_contacts_user on contacts(user_id);
create index if not exists idx_contacts_team on contacts(team_id);
create index if not exists idx_deals_user on deals(user_id);
create index if not exists idx_tasks_user on tasks(user_id);
create index if not exists idx_activities_team on activities(team_id, created_at desc);
create index if not exists idx_contact_notes_contact on contact_notes(contact_id, created_at desc);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS
alter table teams enable row level security;
alter table profiles enable row level security;
alter table contacts enable row level security;
alter table deals enable row level security;
alter table tasks enable row level security;
alter table contact_notes enable row level security;
alter table activities enable row level security;

-- Helper: is team admin
create or replace function public.is_team_admin(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and team_id = tid and role = 'admin'
  );
$$;

-- Helper: same team
create or replace function public.same_team(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and team_id = tid
  );
$$;

-- Teams policies
create policy "team members read own team" on teams for select
  using (same_team(id) or owner_id = auth.uid());

create policy "anyone can read team by invite code" on teams for select
  using (true);

create policy "authenticated users create teams" on teams for insert
  with check (auth.uid() = owner_id);

create policy "admin updates team" on teams for update
  using (is_team_admin(id) or owner_id = auth.uid());

-- Profiles policies
create policy "team members read profiles in team" on profiles for select
  using (team_id is not null and same_team(team_id) or id = auth.uid());

create policy "users update own profile" on profiles for update
  using (id = auth.uid());

create policy "admin updates team profiles" on profiles for update
  using (team_id is not null and is_team_admin(team_id));

-- Contacts
create policy "read contacts in team" on contacts for select
  using (same_team(team_id));

create policy "insert own contacts" on contacts for insert
  with check (user_id = auth.uid() and same_team(team_id));

create policy "update own contacts or admin" on contacts for update
  using (user_id = auth.uid() or is_team_admin(team_id));

create policy "delete own contacts or admin" on contacts for delete
  using (user_id = auth.uid() or is_team_admin(team_id));

-- Deals
create policy "read deals in team" on deals for select using (same_team(team_id));
create policy "insert own deals" on deals for insert with check (user_id = auth.uid() and same_team(team_id));
create policy "update own deals or admin" on deals for update using (user_id = auth.uid() or is_team_admin(team_id));
create policy "delete own deals or admin" on deals for delete using (user_id = auth.uid() or is_team_admin(team_id));

-- Tasks
create policy "read tasks in team" on tasks for select using (same_team(team_id));
create policy "insert own tasks" on tasks for insert with check (user_id = auth.uid() and same_team(team_id));
create policy "update own tasks or admin" on tasks for update using (user_id = auth.uid() or is_team_admin(team_id));
create policy "delete own tasks or admin" on tasks for delete using (user_id = auth.uid() or is_team_admin(team_id));

-- Contact notes
create policy "read notes in team" on contact_notes for select using (same_team(team_id));
create policy "insert own notes" on contact_notes for insert with check (user_id = auth.uid() and same_team(team_id));
create policy "delete own notes or admin" on contact_notes for delete using (user_id = auth.uid() or is_team_admin(team_id));

-- Activities
create policy "read activities in team" on activities for select using (same_team(team_id));
create policy "insert own activities" on activities for insert with check (user_id = auth.uid() and same_team(team_id));

-- Call transcripts (see supabase/migrations/20260617_call_transcripts.sql)
