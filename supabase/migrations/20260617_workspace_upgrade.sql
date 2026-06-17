-- Workspace upgrade: Customer 360, pipeline, roles, timeline, automation

-- Expand roles
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'sales', 'marketing', 'support', 'member'));

-- Companies (multiple contacts per company)
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  domain text default '',
  industry text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table contacts add column if not exists company_id uuid references companies(id) on delete set null;
alter table contacts add column if not exists next_action text default '';

alter table deals add column if not exists company_id uuid references companies(id) on delete set null;
alter table deals add column if not exists stage_entered_at timestamptz default now();
alter table deals add column if not exists next_action text default '';

alter table tasks add column if not exists reminder_at timestamptz;

-- Custom pipeline stages per team
create table if not exists pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  entry_criteria text default '',
  exit_criteria text default '',
  is_closed boolean not null default false,
  is_won boolean not null default false,
  stale_days int not null default 14,
  created_at timestamptz not null default now(),
  unique(team_id, name)
);

-- Unified timeline (Customer 360)
create table if not exists timeline_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,
  event_type text not null check (event_type in ('call', 'email', 'meeting', 'note', 'task', 'deal', 'file', 'ticket', 'system')),
  title text not null,
  body text default '',
  meta jsonb default '{}',
  created_at timestamptz not null default now()
);

-- Workflow automation rules
create table if not exists workflow_rules (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  trigger_type text not null check (trigger_type in ('deal_stage_change', 'contact_created', 'deal_created')),
  trigger_config jsonb default '{}',
  action_type text not null check (action_type in ('create_task', 'timeline_log', 'set_next_action')),
  action_config jsonb default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Integration connectors (config only — OAuth wired later)
create table if not exists team_integrations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'slack', 'calendar', 'zoom')),
  config jsonb default '{}',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique(team_id, provider)
);

create index if not exists idx_companies_team on companies(team_id);
create index if not exists idx_contacts_company on contacts(company_id);
create index if not exists idx_timeline_contact on timeline_events(contact_id, created_at desc);
create index if not exists idx_timeline_company on timeline_events(company_id, created_at desc);
create index if not exists idx_pipeline_stages_team on pipeline_stages(team_id, sort_order);

-- Role helpers
create or replace function public.user_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()), 'member');
$$;

create or replace function public.can_edit_deals()
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_role() in ('admin', 'sales', 'member');
$$;

create or replace function public.can_view_reports()
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_role() in ('admin', 'sales', 'marketing', 'member');
$$;

-- RLS new tables
alter table companies enable row level security;
alter table pipeline_stages enable row level security;
alter table timeline_events enable row level security;
alter table workflow_rules enable row level security;
alter table team_integrations enable row level security;

create policy "read companies in team" on companies for select using (same_team(team_id));
create policy "write companies in team" on companies for insert with check (same_team(team_id));
create policy "update companies in team" on companies for update using (same_team(team_id));
create policy "delete companies admin" on companies for delete using (same_team(team_id) and is_team_admin(team_id));

create policy "read pipeline stages" on pipeline_stages for select using (same_team(team_id));
create policy "admin manage pipeline stages" on pipeline_stages for all using (same_team(team_id) and is_team_admin(team_id));

create policy "read timeline in team" on timeline_events for select using (same_team(team_id));
create policy "insert timeline" on timeline_events for insert with check (user_id = auth.uid() and same_team(team_id));

create policy "read workflows" on workflow_rules for select using (same_team(team_id));
create policy "admin manage workflows" on workflow_rules for all using (same_team(team_id) and is_team_admin(team_id));

create policy "read integrations" on team_integrations for select using (same_team(team_id));
create policy "admin manage integrations" on team_integrations for all using (same_team(team_id) and is_team_admin(team_id));

-- Seed default pipeline stages for existing teams
insert into pipeline_stages (team_id, name, sort_order, entry_criteria, exit_criteria, is_closed, is_won, stale_days)
select t.id, s.name, s.sort_order, s.entry, s.exit, s.closed, s.won, s.stale
from teams t
cross join (values
  ('Lead', 0, 'New inbound or outbound lead', 'Contact qualified interest', false, false, 7),
  ('Qualified', 1, 'Budget and need confirmed', 'Proposal sent', false, false, 10),
  ('Proposal', 2, 'Quote or proposal delivered', 'Verbal yes or contract sent', false, false, 14),
  ('Won', 3, 'Contract signed', '', true, true, 999),
  ('Lost', 4, 'Deal closed lost', '', true, false, 999)
) as s(name, sort_order, entry, exit, closed, won, stale)
on conflict (team_id, name) do nothing;

-- Default workflow rules for existing teams
insert into workflow_rules (team_id, name, trigger_type, trigger_config, action_type, action_config, enabled)
select t.id, 'Follow up on new lead', 'deal_stage_change', '{"to_stage":"Lead"}'::jsonb,
  'create_task', '{"title":"First follow-up within 24h","due_days":1}'::jsonb, true
from teams t
where not exists (select 1 from workflow_rules w where w.team_id = t.id);

insert into workflow_rules (team_id, name, trigger_type, trigger_config, action_type, action_config, enabled)
select t.id, 'Log new contacts', 'contact_created', '{}'::jsonb,
  'timeline_log', '{"title":"Contact added to CRM"}'::jsonb, true
from teams t
where not exists (select 1 from workflow_rules w where w.team_id = t.id and w.trigger_type = 'contact_created');

-- Default integration placeholders
insert into team_integrations (team_id, provider, enabled)
select t.id, p.provider, false
from teams t
cross join (values ('gmail'), ('slack'), ('calendar'), ('zoom')) as p(provider)
on conflict (team_id, provider) do nothing;
