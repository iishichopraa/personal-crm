-- Call transcripts + AI priority analysis

create table if not exists call_transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  title text not null,
  filename text,
  content text not null,
  call_summary text,
  analysis jsonb default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'analyzing', 'done', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_call_transcripts_user on call_transcripts(user_id, created_at desc);
create index if not exists idx_call_transcripts_team on call_transcripts(team_id);

alter table call_transcripts enable row level security;

create policy "read transcripts in team" on call_transcripts for select
  using (same_team(team_id));

create policy "insert own transcripts" on call_transcripts for insert
  with check (user_id = auth.uid() and same_team(team_id));

create policy "update own transcripts or admin" on call_transcripts for update
  using (user_id = auth.uid() or is_team_admin(team_id));

create policy "delete own transcripts or admin" on call_transcripts for delete
  using (user_id = auth.uid() or is_team_admin(team_id));
