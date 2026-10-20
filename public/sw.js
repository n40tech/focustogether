// Focus Together's service worker: it only shows notifications (see
// src/lib/push.ts and supabase/functions/push), and opens the right place
// when one is tapped.

self.addEventListener('push', (event) => {
  const { title = 'Focus Together', body = '', url = '/' } = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/logo192.png',
      // One of each kind at a time: a newer one replaces the last.
      tag: url,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of open) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
