// LinkRoom service worker: only for push notifications (an @mention while you're away). It caches
// nothing. Payloads come from apps/backend lib/webpush.ts: { title, body, room_id, url }.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "LinkRoom", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "You were mentioned on LinkRoom";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      // One notification per room: a new mention replaces the last one from that room.
      tag: data.room_id ? `room-${data.room_id}` : undefined,
      renotify: !!data.room_id,
      data: { url: data.url || (data.room_id ? `/r/${data.room_id}` : "/dashboard") },
    }),
  );
});

// Clicking the notification focuses a tab already on that room, or opens one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/dashboard", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      const open = tabs.find((tab) => tab.url === url);
      if (open) return open.focus();
      return self.clients.openWindow(url);
    }),
  );
});
