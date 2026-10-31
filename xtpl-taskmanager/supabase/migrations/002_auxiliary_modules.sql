-- Persistent storage for the existing Documents, Attendance and Secure QR modules.
-- Run after 001_production_schema.sql.

create table if not exists public.documents (
  id text primary key,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  category text not null check (category in ('Template','Guide / SOP','Report','Collateral','Other')),
  project text not null default '',
  task_id uuid references public.tasks(id) on delete set null,
  task_title text not null default '',
  visibility text not null default 'private' check (visibility in ('everyone','private')),
  original_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 15728640),
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_by_name text not null default '',
  downloads integer not null default 0 check (downloads >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_uploaded_by_idx on public.documents(uploaded_by);
create index if not exists documents_task_idx on public.documents(task_id);
create index if not exists documents_created_idx on public.documents(created_at desc);

create table if not exists public.attendance_records (
  id text primary key,
  sid text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  email text not null,
  role app_role not null,
  login_at timestamptz not null,
  last_seen timestamptz not null,
  logout_at timestamptz,
  logout_reason text not null default '',
  duration_sec integer check (duration_sec is null or duration_sec >= 0),
  ip text not null default '',
  device text not null default '',
  resumed boolean not null default false
);
create index if not exists attendance_user_login_idx on public.attendance_records(user_id, login_at desc);
create index if not exists attendance_sid_idx on public.attendance_records(sid);
create index if not exists attendance_open_idx on public.attendance_records(logout_at) where logout_at is null;

create table if not exists public.secure_qr_codes (
  id text primary key check (id ~ '^q_[0-9a-f]{16}$'),
  label text not null check (char_length(label) between 1 and 60),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  expires_at timestamptz,
  revoked boolean not null default false,
  opened integer not null default 0 check (opened >= 0),
  failed integer not null default 0 check (failed >= 0),
  last_opened_at timestamptz,
  last_opened_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists secure_qr_created_idx on public.secure_qr_codes(created_at desc);

insert into storage.buckets(id, name, public, file_size_limit)
values ('documents','documents',false,15728640)
on conflict (id) do update set public=false, file_size_limit=15728640;

alter table public.documents enable row level security;
alter table public.attendance_records enable row level security;
alter table public.secure_qr_codes enable row level security;
-- Access remains through the Express API using the server-only service role.
