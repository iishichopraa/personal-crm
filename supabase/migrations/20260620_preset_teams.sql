-- Preset org teams: Ploid overall, Devs, Sonia, Kevin

alter table teams add column if not exists slug text unique;

insert into teams (name, slug, invite_code)
values
  ('Ploid Overall', 'ploid', 'ploidall'),
  ('Devs', 'devs', 'ploiddevs'),
  ('Sonia Team', 'sonia', 'ploidsonia'),
  ('Kevin Team', 'kevin', 'ploidkevin')
on conflict (slug) do update set name = excluded.name;

-- Seed pipeline stages for preset teams that don't have any yet
insert into pipeline_stages (team_id, name, sort_order, entry_criteria, exit_criteria, is_closed, is_won, stale_days)
select t.id, s.name, s.sort_order, s.entry_criteria, s.exit_criteria, s.is_closed, s.is_won, s.stale_days
from teams t
cross join (values
  ('Lead', 0, 'New opportunity', 'Qualified or disqualified', false, false, 7),
  ('Qualified', 1, 'Budget and need confirmed', 'Proposal sent', false, false, 10),
  ('Proposal', 2, 'Proposal delivered', 'Won or lost', false, false, 14),
  ('Won', 3, 'Deal closed won', '', true, true, null),
  ('Lost', 4, 'Deal closed lost', '', true, false, null)
) as s(name, sort_order, entry_criteria, exit_criteria, is_closed, is_won, stale_days)
where t.slug in ('ploid', 'devs', 'sonia', 'kevin')
  and not exists (select 1 from pipeline_stages ps where ps.team_id = t.id);

-- Let signed-in users see who's on each preset team
drop policy if exists "read members of preset teams" on profiles;
create policy "read members of preset teams" on profiles for select
  using (
    auth.uid() is not null
    and exists (
      select 1 from teams t
      where t.id = profiles.team_id
        and t.slug in ('ploid', 'devs', 'sonia', 'kevin')
    )
  );
