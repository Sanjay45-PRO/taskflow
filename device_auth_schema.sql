-- ============================================================
-- NEW-DEVICE OTP AUTHENTICATION — schema additions
-- Run once in Supabase SQL editor.
-- ============================================================

-- One row per phone an employee has ever logged in from.
create table if not exists user_devices (
  id uuid primary key default gen_random_uuid(),
  team text not null,
  employee_name text not null,
  device_id text not null,              -- stable hardware/installation id (see DEVICE_ID_NOTES.md)
  device_name text,                     -- e.g. "Samsung Galaxy A14"
  platform text,                        -- 'android' | 'ios'
  app_version text,
  is_approved boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  approved_at timestamptz,
  revoked_at timestamptz
);
create unique index if not exists idx_user_devices_unique on user_devices(team, employee_name, device_id);
create index if not exists idx_user_devices_lookup on user_devices(team, employee_name);

-- OTP codes for new-device verification. Code is stored hashed, never plain text.
create table if not exists device_otps (
  id uuid primary key default gen_random_uuid(),
  team text not null,
  employee_name text not null,
  device_id text not null,
  code_hash text not null,              -- sha-256 hex of the 6-digit code
  attempts integer not null default 0,  -- failed verify attempts against this code
  max_attempts integer not null default 5,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,      -- created_at + 5 minutes
  consumed boolean not null default false,
  consumed_at timestamptz
);
create index if not exists idx_device_otps_lookup on device_otps(team, employee_name, device_id, consumed);

-- Simple resend/rate-limit tracker per employee+device (separate from the OTP rows
-- themselves so a rate-limit check doesn't depend on a specific code existing).
create table if not exists device_otp_requests (
  id uuid primary key default gen_random_uuid(),
  team text not null,
  employee_name text not null,
  device_id text not null,
  requested_at timestamptz not null default now()
);
create index if not exists idx_device_otp_requests_lookup on device_otp_requests(team, employee_name, device_id, requested_at);

-- Permissions
alter table user_devices enable row level security;
create policy "user_devices_all" on user_devices for all using (true) with check (true);
grant select, insert, update, delete on user_devices to anon, authenticated, service_role;

alter table device_otps enable row level security;
create policy "device_otps_all" on device_otps for all using (true) with check (true);
grant select, insert, update, delete on device_otps to anon, authenticated, service_role;

alter table device_otp_requests enable row level security;
create policy "device_otp_requests_all" on device_otp_requests for all using (true) with check (true);
grant select, insert, update, delete on device_otp_requests to anon, authenticated, service_role;
