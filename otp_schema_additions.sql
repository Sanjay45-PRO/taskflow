-- LOGIN OTP GATE
-- One row per requested code. A fresh code is required every time the app is opened.
create table if not exists login_otps (
  id uuid primary key default gen_random_uuid(),
  team text not null,
  employee_name text not null,
  code text not null,
  created_at timestamptz default now(),
  expires_at timestamptz not null,
  verified boolean not null default false,
  verified_at timestamptz
);
create index if not exists idx_login_otps_lookup on login_otps(team, employee_name, code);

alter table login_otps enable row level security;
create policy "login_otps_all" on login_otps for all using (true) with check (true);
grant select, insert, update, delete on login_otps to anon, authenticated, service_role;
