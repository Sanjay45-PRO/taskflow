-- ============================================================
-- TaskFlow — Schema additions beyond the original tables
-- (members, tasks, tickets, login_log already exist from the
-- original TaskFlow web app schema.sql)
-- Safe to re-run end to end; every statement is idempotent.
-- ============================================================

-- ============ LOCATION TRACKING ============
create table if not exists location_logs (
  id uuid primary key default gen_random_uuid(),
  team text not null,
  employee_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  recorded_at timestamptz default now()
);
create index if not exists idx_location_logs_team_emp on location_logs(team, employee_name, recorded_at);

-- ============ ATTENDANCE ============
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  team text not null,
  employee_name text not null,
  check_in_at timestamptz,
  check_in_lat double precision,
  check_in_lng double precision,
  check_out_at timestamptz,
  check_out_lat double precision,
  check_out_lng double precision,
  work_date date not null default current_date
);
create unique index if not exists idx_attendance_one_per_day on attendance(team, employee_name, work_date);

-- ============ EXPENSE CLAIMS ============
create table if not exists expense_claims (
  id uuid primary key default gen_random_uuid(),
  team text not null,
  employee_name text not null,
  amount numeric(10,2) not null,
  category text not null check (category in ('travel','food','accommodation','other')),
  note text,
  receipt_url text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  rejection_reason text
);
create index if not exists idx_expense_claims_team on expense_claims(team, status);
alter table expense_claims add column if not exists rejection_reason text;

-- ============ ON-DUTY REQUESTS ============
create table if not exists onduty_requests (
  id uuid primary key default gen_random_uuid(),
  team text not null,
  employee_name text not null,
  request_date date not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by text
);
create unique index if not exists idx_onduty_one_per_day on onduty_requests(team, employee_name, request_date);

-- ============ MEMBERS TABLE ADDITIONS (reminder cooldown tracking) ============
alter table members add column if not exists last_email_at timestamptz;
alter table members add column if not exists email_sent_count integer default 0;

-- ============ PERMISSIONS (RLS + grants) ============
alter table location_logs enable row level security;
drop policy if exists "location_logs_all" on location_logs;
create policy "location_logs_all" on location_logs for all using (true) with check (true);
grant select, insert, update, delete on location_logs to anon, authenticated, service_role;

alter table attendance enable row level security;
drop policy if exists "attendance_all" on attendance;
create policy "attendance_all" on attendance for all using (true) with check (true);
grant select, insert, update, delete on attendance to anon, authenticated, service_role;

alter table expense_claims enable row level security;
drop policy if exists "expense_claims_all" on expense_claims;
create policy "expense_claims_all" on expense_claims for all using (true) with check (true);
grant select, insert, update, delete on expense_claims to anon, authenticated, service_role;

alter table onduty_requests enable row level security;
drop policy if exists "onduty_requests_all" on onduty_requests;
create policy "onduty_requests_all" on onduty_requests for all using (true) with check (true);
grant select, insert, update, delete on onduty_requests to anon, authenticated, service_role;

-- Explicit grants on members/tasks — service_role needs more than just SELECT
-- (real bug we hit: the Edge Function silently failed to update
-- last_email_at/email_sent_count until these were granted explicitly)
grant select, insert, update, delete on members to anon, authenticated, service_role;
grant select, insert, update, delete on tasks to anon, authenticated, service_role;

-- ============ STORAGE BUCKETS ============
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('task-attachments', 'task-attachments', true) on conflict (id) do nothing;

drop policy if exists "receipts_all" on storage.objects;
create policy "receipts_all" on storage.objects
for all using (bucket_id = 'receipts') with check (bucket_id = 'receipts');

drop policy if exists "task_attachments_all" on storage.objects;
create policy "task_attachments_all" on storage.objects
for all using (bucket_id = 'task-attachments') with check (bucket_id = 'task-attachments');

grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select, insert, update, delete on storage.buckets to anon, authenticated, service_role;
