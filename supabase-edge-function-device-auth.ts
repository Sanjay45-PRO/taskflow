// Deploy as its own function: supabase functions deploy device-auth
// Secrets needed (Project Settings -> Edge Functions -> Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (already set for dynamic-action)
//   RESEND_API_KEY                             (already set for dynamic-action)
//   MANAGER_NOTIFY_EMAIL                       (the one inbox that receives every OTP)
//
// All device-approval and OTP logic runs here — the app never decides on its own
// whether a device is approved. It only ever asks this function.
//
// Actions (POST JSON body):
//   { action: "check_device",  team, employee_name, device_id, device_name, platform, app_version }
//   { action: "request_otp",   team, employee_name, device_id }
//   { action: "verify_otp",    team, employee_name, device_id, code }
//   { action: "list_devices",  team }                                    (manager dashboard)
//   { action: "revoke_device", team, device_row_id }                     (manager dashboard)

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM = 'TaskFlow <taskflow@greentechrenewable.com>';
const MANAGER_NOTIFY_EMAIL = Deno.env.get('MANAGER_NOTIFY_EMAIL');

const OTP_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;      // minimum gap between two OTP requests for the same device
const MAX_REQUESTS_PER_HOUR = 6;         // hard rate limit per employee+device

function genCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sendEmail(toEmail: string, subject: string, text: string) {
  if (!RESEND_API_KEY || !toEmail) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: toEmail, subject, text }),
    });
    return res.ok;
  } catch (e) {
    console.error('email send failed:', e.message); // never log the OTP itself
    return false;
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const body = await req.json();
    const { action, team, employee_name } = body;

    // ---------------------------------------------------------------
    // 1. Is this device already approved for this employee?
    // ---------------------------------------------------------------
    if (action === 'check_device') {
      const { device_id, device_name, platform, app_version } = body;
      if (!team || !employee_name || !device_id) return json({ error: 'team, employee_name, device_id required' }, 400);

      const { data: existing, error } = await supabase
        .from('user_devices')
        .select('*')
        .eq('team', team)
        .eq('employee_name', employee_name)
        .eq('device_id', device_id)
        .maybeSingle();
      if (error) throw error;

      if (existing) {
        // touch last_seen_at, and refresh device metadata in case app/OS updated
        await supabase.from('user_devices').update({
          last_seen_at: new Date().toISOString(),
          device_name: device_name ?? existing.device_name,
          platform: platform ?? existing.platform,
          app_version: app_version ?? existing.app_version,
        }).eq('id', existing.id);

        if (existing.revoked_at) return json({ approved: false, revoked: true });
        if (existing.is_approved) return json({ approved: true });
        return json({ approved: false, revoked: false }); // registered but never completed OTP
      }

      // First time this device_id has ever been seen for this employee — create the row, unapproved.
      const { error: insErr } = await supabase.from('user_devices').insert({
        team, employee_name, device_id, device_name, platform, app_version, is_approved: false,
      });
      if (insErr) throw insErr;
      return json({ approved: false, revoked: false });
    }

    // ---------------------------------------------------------------
    // 2. Request an OTP for a new device
    // ---------------------------------------------------------------
    if (action === 'request_otp') {
      const { device_id } = body;
      if (!team || !employee_name || !device_id) return json({ error: 'team, employee_name, device_id required' }, 400);

      const nowIso = new Date().toISOString();
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const cooldownAgo = new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000).toISOString();

      const { data: recent, error: recentErr } = await supabase
        .from('device_otp_requests')
        .select('requested_at')
        .eq('team', team).eq('employee_name', employee_name).eq('device_id', device_id)
        .gte('requested_at', hourAgo)
        .order('requested_at', { ascending: false });
      if (recentErr) throw recentErr;

      if (recent && recent.length > 0 && recent[0].requested_at > cooldownAgo) {
        const waitSec = Math.ceil((new Date(recent[0].requested_at).getTime() + RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000);
        return json({ ok: false, reason: 'cooldown', wait_seconds: Math.max(waitSec, 1) });
      }
      if (recent && recent.length >= MAX_REQUESTS_PER_HOUR) {
        return json({ ok: false, reason: 'rate_limited' });
      }

      // invalidate any earlier unconsumed OTPs for this employee+device
      await supabase.from('device_otps')
        .update({ consumed: true, consumed_at: nowIso })
        .eq('team', team).eq('employee_name', employee_name).eq('device_id', device_id)
        .eq('consumed', false);

      const code = genCode();
      const code_hash = await hashCode(code);
      const expires_at = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

      const { error: insErr } = await supabase.from('device_otps').insert({
        team, employee_name, device_id, code_hash, expires_at, max_attempts: MAX_ATTEMPTS,
      });
      if (insErr) throw insErr;

      await supabase.from('device_otp_requests').insert({ team, employee_name, device_id });

      const sent = await sendEmail(
        MANAGER_NOTIFY_EMAIL!,
        `TaskFlow: new device for ${employee_name}`,
        `${employee_name} (workspace: ${team}) is signing in to TaskFlow from a phone that isn't approved yet.\n\n` +
        `Verification code: ${code}\n\n` +
        `This code expires in ${OTP_TTL_MINUTES} minutes. Only share it with ${employee_name} if you expect them to be setting up a new phone right now.`
      );

      return json({ ok: true, emailed: sent, expires_in_seconds: OTP_TTL_MINUTES * 60 });
    }

    // ---------------------------------------------------------------
    // 3. Verify an OTP and approve the device
    // ---------------------------------------------------------------
    if (action === 'verify_otp') {
      const { device_id, code, device_name, platform, app_version } = body;
      if (!team || !employee_name || !device_id || !code) return json({ error: 'team, employee_name, device_id, code required' }, 400);

      const { data: otp, error } = await supabase
        .from('device_otps')
        .select('*')
        .eq('team', team).eq('employee_name', employee_name).eq('device_id', device_id)
        .eq('consumed', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;

      if (!otp) return json({ ok: false, reason: 'no_active_code' });
      if (new Date(otp.expires_at) < new Date()) return json({ ok: false, reason: 'expired' });
      if (otp.attempts >= otp.max_attempts) return json({ ok: false, reason: 'too_many_attempts' });

      const hash = await hashCode(String(code));
      if (hash !== otp.code_hash) {
        await supabase.from('device_otps').update({ attempts: otp.attempts + 1 }).eq('id', otp.id);
        const remaining = otp.max_attempts - (otp.attempts + 1);
        return json({ ok: false, reason: 'incorrect', attempts_remaining: Math.max(remaining, 0) });
      }

      // correct — consume the OTP and approve the device
      await supabase.from('device_otps').update({ consumed: true, consumed_at: new Date().toISOString() }).eq('id', otp.id);

      const { error: upErr } = await supabase.from('user_devices')
        .update({
          is_approved: true,
          approved_at: new Date().toISOString(),
          revoked_at: null,
          last_seen_at: new Date().toISOString(),
          device_name, platform, app_version,
        })
        .eq('team', team).eq('employee_name', employee_name).eq('device_id', device_id);
      if (upErr) throw upErr;

      return json({ ok: true });
    }

    // ---------------------------------------------------------------
    // 4. Manager dashboard — list all devices for the team
    // ---------------------------------------------------------------
    if (action === 'list_devices') {
      if (!team) return json({ error: 'team required' }, 400);
      const { data, error } = await supabase
        .from('user_devices')
        .select('*')
        .eq('team', team)
        .order('employee_name', { ascending: true })
        .order('last_seen_at', { ascending: false });
      if (error) throw error;
      return json({ devices: data });
    }

    // ---------------------------------------------------------------
    // 5. Manager dashboard — revoke a device
    // ---------------------------------------------------------------
    if (action === 'revoke_device') {
      const { device_row_id } = body;
      if (!team || !device_row_id) return json({ error: 'team, device_row_id required' }, 400);
      const { error } = await supabase.from('user_devices')
        .update({ is_approved: false, revoked_at: new Date().toISOString() })
        .eq('team', team).eq('id', device_row_id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e.message }, 500);
  }
});
