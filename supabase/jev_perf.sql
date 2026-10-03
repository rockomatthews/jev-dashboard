-- jev-dashboard live feed: one row holding the bot's latest performance snapshot.
-- Run once in the Supabase SQL editor. The site reads/writes it server-side with the service-role key,
-- so row-level security stays on with no public policies (nobody can read it with the anon key).
create table if not exists public.jev_perf (
  id          text primary key,
  received_ms bigint not null,
  perf        jsonb  not null,
  updated_at  timestamptz not null default now()
);
alter table public.jev_perf enable row level security;
