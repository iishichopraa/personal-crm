-- Company-wide people directory; users add people to their own CRM from here

create table if not exists directory_people (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  email text default '',
  phone text default '',
  company text default '',
  company_id uuid references companies(id) on delete set null,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table contacts add column if not exists directory_person_id uuid references directory_people(id) on delete set null;

create index if not exists idx_directory_people_team on directory_people(team_id, name);
create unique index if not exists idx_contacts_user_directory on contacts(user_id, directory_person_id) where directory_person_id is not null;

alter table directory_people enable row level security;

create policy "read directory in team" on directory_people for select using (same_team(team_id));
create policy "admin manage directory" on directory_people for all using (same_team(team_id) and is_team_admin(team_id));
create policy "team insert directory" on directory_people for insert with check (same_team(team_id));

-- Move shared imports into company directory (not owned by any one user)
insert into directory_people (team_id, name, email, phone, company, company_id, notes)
select team_id, name, email, phone, company, company_id, notes
from contacts
where team_id is not null
  and not exists (
    select 1 from directory_people d
    where d.team_id = contacts.team_id and d.name = contacts.name and d.company = contacts.company
  );

delete from contacts
where team_id is not null
  and exists (
    select 1 from directory_people d
    where d.team_id = contacts.team_id and d.name = contacts.name and d.company = contacts.company
  );
