import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

webpush.setVapidDetails(
  'mailto:admin@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
);

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM = 'TaskFlow <taskflow@greentechrenewable.com>';

function isOverdue(t: any): boolean {
  if (!t.due || t.status === 'done') return false;
  return new Date(`${t.due}T23:59:59`) < new Date();
}

function isDueSoon(t: any): boolean {
  if (!t.due || t.status === 'done') return false;
  const due = new Date(`${t.due}T23:59:59`);
  const hrs = (due.getTime() - Date.now()) / 36e5;
  return hrs >= 0 && hrs <= 24;
}

function withinBusinessHours(): boolean {
  const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const minutes = istNow.getHours() * 60 + istNow.getMinutes();
  return minutes >= 10 * 60 + 30 && minutes <= 18 * 60 + 30; // 10:30 AM - 6:30 PM IST
}

// Email cooldown only. Push has no cooldown — it fires on every cron check (~every 30 min)
// as long as there's pending work, since it's a lightweight notification, not an inbox message.
function emailDue(lastEmailAt: string | null, gapHours: number): boolean {
  if (!lastEmailAt) return true;
  const hrsSince = (Date.now() - new Date(lastEmailAt).getTime()) / 36e5;
  return hrsSince >= gapHours;
}

async function sendPush(member: any, title: string, body: string) {
  if (!member.push_subscription) return false;
  try {
    await webpush.sendNotification(member.push_subscription, JSON.stringify({ title, body }));
    return true;
  } catch (e) {
    console.error('push failed for', member.name, e.message);
    return false;
  }
}

async function sendEmail(toEmail: string, subject: string, text: string) {
  if (!RESEND_API_KEY || !toEmail) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: toEmail, subject, text })
    });
    const body = await res.text();
    if (!res.ok) {
      console.error('resend rejected email to', toEmail, res.status, body);
      return false;
    }
    console.log('resend accepted email to', toEmail, body);
    return true;
  } catch (e) {
    console.error('email failed for', toEmail, e.message);
    return false;
  }
}

async function markEmailSent(team: string, member: any) {
  const updates = {
    last_email_at: new Date().toISOString(),
    email_sent_count: (member.email_sent_count || 0) + 1
  };
  const { error } = await supabase.from('members').update(updates).eq('team', team).eq('name', member.name);
  if (error) console.error('markEmailSent FAILED for', member.name, JSON.stringify(error));
  else console.log('markEmailSent OK for', member.name);
}

function summaryFor(list: any[]): string {
  const overdueCount = list.filter(isOverdue).length;
  const dueSoonCount = list.filter(isDueSoon).length;
  const restCount = list.length - overdueCount - dueSoonCount;
  const parts: string[] = [];
  if (overdueCount) parts.push(`${overdueCount} overdue`);
  if (dueSoonCount) parts.push(`${dueSoonCount} due within 24 hours`);
  if (restCount) parts.push(`${restCount} pending`);
  return parts.join(', ');
}

Deno.serve(async () => {
  if (!withinBusinessHours()) {
    return new Response(JSON.stringify({ skipped: 'outside business hours' }));
  }

  const { data: tasks, error } = await supabase.from('tasks').select('*').eq('status', 'pending');
  if (error) return new Response(JSON.stringify({ error }), { status: 500 });
  if (!tasks || !tasks.length) return new Response(JSON.stringify({ pushed: 0, emailed: 0 }));

  let pushed = 0, emailed = 0;

  const byAssignee = new Map<string, any[]>();
  for (const t of tasks) {
    const key = `${t.team}::${t.assignee.trim().toLowerCase()}`;
    if (!byAssignee.has(key)) byAssignee.set(key, []);
    byAssignee.get(key)!.push(t);
  }

  for (const [key, list] of byAssignee.entries()) {
    const [team, assigneeKey] = key.split('::');
    const { data: member } = await supabase
      .from('members').select('*').eq('team', team).ilike('name', assigneeKey).maybeSingle();
    if (!member) continue;

    const hasOverdue = list.some(isOverdue);
    const hasUrgent = hasOverdue || list.some(isDueSoon);
    const summary = summaryFor(list);
    const lines = list.map((t: any) => `- ${t.title}${t.due ? ` (due ${t.due})` : ''}${isOverdue(t) ? ' — OVERDUE' : ''}`).join('\n');
    const greeting = hasUrgent ? 'You have' : 'Gentle reminder — you still have';

    // Push: fires every cron check while there's pending work — no cooldown, it's just a nudge
    if (await sendPush(member, 'Task reminder', `${greeting} ${summary}. Tap to view.`)) pushed++;

    // Email: gated — 1 hour once overdue, otherwise 2 hours (~3-4 gentle emails across the day)
    const gapHours = hasOverdue ? 1 : 2;
    if (emailDue(member.last_email_at, gapHours)) {
      const e = await sendEmail(member.email, `TaskFlow: ${summary}`,
        `${greeting} ${summary}:\n\n${lines}\n\nOpen TaskFlow to mark these done or check details.`);
      if (e) { emailed++; await markEmailSent(team, member); }
    }
  }

  const byTeam = new Map<string, any[]>();
  for (const t of tasks) {
    if (!byTeam.has(t.team)) byTeam.set(t.team, []);
    byTeam.get(t.team)!.push(t);
  }

  for (const [team, list] of byTeam.entries()) {
    const { data: managers } = await supabase
      .from('members').select('*').eq('team', team).eq('role', 'manager');
    if (!managers || !managers.length) continue;

    const hasOverdue = list.some(isOverdue);
    const summary = summaryFor(list);
    const byPerson = new Map<string, number>();
    for (const t of list) byPerson.set(t.assignee, (byPerson.get(t.assignee) || 0) + 1);
    const lines = [...byPerson.entries()].map(([name, n]) => `- ${name}: ${n} task${n > 1 ? 's' : ''}`).join('\n');

    for (const mgr of managers) {
      if (await sendPush(mgr, 'Team reminder', `Your team has ${summary}.`)) pushed++;

      const gapHours = hasOverdue ? 1 : 2;
      if (emailDue(mgr.last_email_at, gapHours)) {
        const e = await sendEmail(mgr.email, `TaskFlow team digest: ${summary}`,
          `Your team has ${summary} across these people:\n\n${lines}\n\nOpen TaskFlow for full details.`);
        if (e) { emailed++; await markEmailSent(team, mgr); }
      }
    }
  }

  return new Response(JSON.stringify({ pushed, emailed }), { headers: { 'Content-Type': 'application/json' } });
});
