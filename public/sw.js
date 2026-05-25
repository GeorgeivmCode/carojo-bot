self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch {}

  const isTest = data.test === true;
  const isOldClient = data.type === 'old_client';
  const name = data.name || 'Cliente';

  let title, body, tag, vibrate;

  if (isTest) {
    title = 'Prueba de notificacion';
    body  = 'Las notificaciones funcionan correctamente.';
    tag   = 'carojo-test';
    vibrate = [200];
  } else if (isOldClient) {
    title = 'Cliente antiguo sin acceso';
    body  = `${name} dice que ya habia comprado. Verificar y usar Restaurar Acceso.`;
    tag   = 'carojo-old-client';
    vibrate = [300, 100, 300, 100, 300];
  } else {
    const pack = (data.pack || 'pack');
    const packLabel = pack.charAt(0).toUpperCase() + pack.slice(1);
    title = 'Venta confirmada!';
    body  = `${name} compro el pack ${packLabel}`;
    tag   = 'carojo-sale';
    vibrate = [100, 50, 200, 50, 400, 50, 200];
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag,
      renotify: true,
      vibrate,
      data: { url: '/admin.html' }
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
