create extension if not exists pgcrypto;

create type public.app_role as enum ('admin','employee');
create type public.task_status as enum ('Todo','In progress','Submitted','Done');
create type public.task_priority as enum ('High','Medium','Low');

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null unique,
  initials text not null default '',
  role app_role not null default 'employee',
  password_hash text not null,
  email_verified boolean not null default true,
  chat_emails boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  color text not null default 'blue',
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  project_id uuid not null references public.projects(id) on delete restrict,
  assigned_user_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  assigned_by uuid references public.profiles(id) on delete set null,
  status task_status not null default 'Todo',
  priority task_priority not null default 'Medium',
  start_date date,
  due_date date,
  submission_note text not null default '',
  review_note text not null default '',
  submitted_at timestamptz,
  claimed_at timestamptz,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_date_order check (start_date is null or due_date is null or due_date >= start_date)
);

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  original_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 15728640),
  created_at timestamptz not null default now()
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_user_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  kind text not null default 'note' check (kind in ('note','submission','approval','rejection')),
  created_at timestamptz not null default now()
);

create table public.task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_assigned_user_idx on public.tasks(assigned_user_id);
create index tasks_project_idx on public.tasks(project_id);
create index tasks_status_idx on public.tasks(status);
create index tasks_priority_idx on public.tasks(priority);
create index tasks_due_date_idx on public.tasks(due_date);
create index activity_task_created_idx on public.task_activity(task_id, created_at desc);
create index notifications_user_created_idx on public.notifications(user_id, created_at desc);

insert into public.projects(name, description, color) values
('Marketing','Ads, social, WhatsApp and content','blue'),
('Telecalling Reports','Daily and weekly calling reports','violet'),
('Training & Demo Sessions','Product demos and team training','cyan'),
('Operations','Orders, payments and inventory','orange')
on conflict (name) do nothing;

insert into storage.buckets(id, name, public, file_size_limit)
values ('task-attachments','task-attachments',false,15728640)
on conflict (id) do update set public=false, file_size_limit=15728640;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_activity enable row level security;
alter table public.notifications enable row level security;
-- The Express API uses the server-only service-role key and performs authorization in middleware.
-- Do not expose that key to the browser. If direct browser Supabase access is added later, add explicit authenticated RLS policies first.
