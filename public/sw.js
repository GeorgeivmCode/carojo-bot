self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch {}

  const isTest = data.test === true;
  const pack = (data.pack || 'pack');
  const packLabel = pack.charAt(0).toUpperCase() + pack.slice(1);
  const name = data.name || 'Cliente';

  const title = isTest ? 'Prueba de notificacion' : 'Venta confirmada!';
  const body  = isTest ? 'Las notificaciones funcionan correctamente.' : `${name} compro el pack ${packLabel}`;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: 'carojo-sale',
      renotify: true,
      vibrate: [100, 50, 200, 50, 400, 50, 200],
      data: { url: '/admin.html?sale=1' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('/admin') && 'focus' in client) return client.focus();
      }
      return clients.openWindow('/admin.html?sale=1');
    })
  );
});
