// 如果是在 3002 特调端口或本地环境，Service Worker 自我注销并直通网络，彻底不拦截 fetch 请求！
const isLocalBypass =
  self.location.port === "3002" ||
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1";

if (isLocalBypass) {
  self.addEventListener("install", () => {
    self.skipWaiting();
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.claim())
    );
  });
  // 在 3002 本地特调环境下绝不注册 fetch 监听器，确保每次刷新都 100% 直达 Node 服务端！
} else {
  const CACHE_VERSION = "ai-phone-pwa-v15-hua-diy";
  const STATIC_CACHE = `${CACHE_VERSION}-static`;
  const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

  const PRECACHE_URLS = [
    "/",
    "/manifest.json",
    "/icon-192.png",
    "/icon-512.png",
  ];

  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(STATIC_CACHE)
        .then((cache) => cache.addAll(PRECACHE_URLS))
        .then(() => self.skipWaiting())
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        ))
        .then(() => caches.open(STATIC_CACHE))
        .then((cache) => cache.add(new Request("/", { cache: "reload" })).catch(() => {}))
        .then(() => self.clients.claim())
    );
  });

  function isCacheableRequest(request) {
    if (request.method !== "GET") return false;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return false;
    if (url.pathname.startsWith("/api/")) return false;
    if (url.pathname.startsWith("/_next/static/")) return true;
    return ["font", "image", "script", "style", "worker"].includes(request.destination);
  }

  async function networkFirst(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      const fallback = await caches.match("/");
      if (fallback) return fallback;
      throw error;
    }
  }

  async function cacheFirst(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  }

  self.addEventListener("push", (event) => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch (error) {
      data = { body: event.data ? event.data.text() : "" };
    }
    const declarative = data.web_push === 8030 && data.notification && typeof data.notification === "object"
      ? data.notification
      : null;
    const notificationData = declarative && declarative.data && typeof declarative.data === "object"
      ? declarative.data
      : data;
    const title = (declarative && declarative.title) || data.title || "小手机";
    event.waitUntil((async () => {
      if (notificationData.type === "chat_outbox") {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const visible = windows.filter((client) => client.visibilityState === "visible");
        if (visible.length > 0) {
          visible.forEach((client) => client.postMessage({ type: "push_outbox_ready" }));
          return;
        }
      }
      if (notificationData.type === "incoming_call") {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const visible = windows.filter((client) => client.visibilityState === "visible");
        if (visible.length > 0) {
          visible.forEach((client) => client.postMessage({
            type: "incoming_call_push",
            sessionId: notificationData.sessionId || "",
            callTs: notificationData.callTs || 0,
          }));
          visible.forEach((client) => client.postMessage({ type: "push_outbox_ready" }));
          return;
        }
      }
      await self.registration.showNotification(title, {
        body: (declarative && declarative.body) || data.body || "",
        icon: (declarative && declarative.icon) || data.icon || "/icon-192.png",
        badge: (declarative && declarative.badge) || "/icon-192.png",
        tag: (declarative && declarative.tag) || data.tag || `push-${Date.now()}`,
        data: {
          url: (declarative && declarative.navigate) || notificationData.url || "/",
          type: notificationData.type || "",
          commandId: notificationData.commandId || "",
          sessionId: notificationData.sessionId || "",
          callTs: notificationData.callTs || 0,
        },
      });
    })());
  });

  self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const notificationData = event.notification.data || {};
    const targetUrl = notificationData.url || "/";
    if (notificationData.type === "shortcut_command") {
      event.waitUntil((async () => {
        const absoluteUrl = new URL(targetUrl, self.location.origin).href;
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of windows) {
          if ("focus" in client) {
            client.postMessage({ type: "run_shortcut", url: absoluteUrl });
            return client.focus();
          }
        }
        return self.clients.openWindow(absoluteUrl);
      })());
      return;
    }
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            if (notificationData.type === "chat_outbox") {
              client.postMessage({ type: "push_outbox_ready" });
            }
            if (notificationData.type === "incoming_call") {
              client.postMessage({
                type: "incoming_call_push",
                sessionId: notificationData.sessionId || "",
                callTs: notificationData.callTs || 0,
              });
              client.postMessage({ type: "push_outbox_ready" });
            }
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      })
    );
  });

  self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.mode === "navigate") {
      event.respondWith(networkFirst(request));
      return;
    }
    if (isCacheableRequest(request)) {
      event.respondWith(cacheFirst(request));
    }
  });
}
