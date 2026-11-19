const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    return;
  }
  if (!UUID.test(data?.projectId) || !UUID.test(data?.messageId)) return;

  event.waitUntil(
    self.registration.showNotification('DevTrack', {
      body: 'New project chat message',
      icon: '/app-icon-192.png',
      tag: data.messageId,
      data: { path: `/projects/${data.projectId}/chat?message=${data.messageId}` },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.path;
  if (typeof path !== 'string' || !path.startsWith('/projects/')) return;
  const url = new URL(path, self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((client) => client.url === url.href);
      if (existing) return existing.focus();
      return self.clients.openWindow(url.href);
    })(),
  );
});
