"use client";

import { useEffect } from "react";

export function PWARegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const isDev = process.env.NODE_ENV !== "production";
    const isTestPortOrLocal =
      typeof window !== "undefined" &&
      (window.location.port === "3002" ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname.startsWith("192.168.") ||
        window.location.hostname.startsWith("10."));

    // 在开发环境或 3002 本地特调端口下，主动注销残留的 Service Worker 并清理静态缓存，
    // 确保华只要在普通窗口按刷新就能直接向本地拉取最新代码，告别无痕窗口和旧缓存死锁！
    if (isDev || isTestPortOrLocal) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister().catch(() => {});
        }
      }).catch(() => {});

      if ("caches" in window) {
        caches.keys().then((keys) => {
          for (const key of keys) {
            caches.delete(key).catch(() => {});
          }
        }).catch(() => {});
      }
      return;
    }

    let cancelled = false;
    const register = () => {
      if (cancelled) return;
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
        console.warn("[PWA] Service worker registration failed:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return () => {
        cancelled = true;
      };
    }

    window.addEventListener("load", register, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
