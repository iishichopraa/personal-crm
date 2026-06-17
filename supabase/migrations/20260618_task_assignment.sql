-- Task assignment from call transcripts + personal calendar fields

alter table tasks add column if not exists assigned_to uuid references profiles(id) on delete set null;
alter table tasks add column if not exists transcript_id uuid references call_transcripts(id) on delete set null;
alter table tasks add column if not exists source_step_index int;
alter table tasks add column if not exists description text default '';

alter table call_transcripts add column if not exists assigned_to uuid references profiles(id) on delete set null;

create index if not exists idx_tasks_assigned on tasks(assigned_to, due_date);
create index if not exists idx_tasks_transcript on tasks(transcript_id, source_step_index);

drop policy if exists "read tasks in team" on tasks;
create policy "read tasks in team" on tasks for select
  using (
    same_team(team_id)
    and (user_id = auth.uid() or assigned_to = auth.uid() or is_team_admin(team_id))
  );

drop policy if exists "update own tasks or admin" on tasks;
create policy "update own tasks or admin" on tasks for update
  using (user_id = auth.uid() or assigned_to = auth.uid() or is_team_admin(team_id));
