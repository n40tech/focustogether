// Sends the notifications that are due: public.due_pushes in
// supabase/migrations/0015_notifications.sql says which, and marks each sent,
// so calling this more often than the Supabase Cron job does (every minute)
// does no harm. Needs the secrets VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
// (npm run vapid-keys makes a pair).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'https://focustogether.expo.app',
  Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
);

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

type Due = { endpoint: string; p256dh: string; auth: string; title: string; body: string; url: string };

Deno.serve(async () => {
  const { data, error } = await db.rpc('due_pushes');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    (data as Due[]).map(async (p) => {
      try {
        await webpush.sendNotification(
          { endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } },
          JSON.stringify({ title: p.title, body: p.body, url: p.url }),
          // Old news isn't worth waking a phone for.
          { TTL: 600 }
        );
        sent += 1;
      } catch (e) {
        const { statusCode: status, body } = e as { statusCode?: number; body?: string };
        console.error('Push failed', status, body ?? (e as Error).message);
        // The device unsubscribed, or the app was uninstalled: stop trying it.
        if (status === 404 || status === 410) gone.push(p.endpoint);
      }
    })
  );
  if (gone.length) await db.rpc('forget_pushes', { p_endpoints: gone });
  return Response.json({ sent, gone: gone.length });
});
