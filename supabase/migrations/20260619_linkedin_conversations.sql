-- LinkedIn conversations share call_transcripts storage with source_type

alter table call_transcripts add column if not exists source_type text not null default 'call';

create index if not exists idx_call_transcripts_source
  on call_transcripts(user_id, source_type, created_at desc);
