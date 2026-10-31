-- Run this in the Supabase SQL Editor to create the hosted chat table.
-- The server uses the service-role key and accesses this table through the REST API.
create table if not exists public.chat_messages (
  id text primary key,
  user_id text not null,
  name text not null,
  text text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_created_at_idx on public.chat_messages (created_at desc);
-- Only the server (service-role key, which bypasses RLS) may touch this table. With RLS off, anyone
-- holding the project's public anon key could read or write every chat message.
alter table public.chat_messages enable row level security;
