export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (!import.meta.env.PROD) {
    window.addEventListener("load", () => {
      clearTypingLabServiceWorkers().catch((error: unknown) => {
        console.warn("TypingLab development service worker cleanup failed", error);
      });
    });
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.update())
      .catch((error: unknown) => {
        console.warn("TypingLab service worker registration failed", error);
      });
  });
}

async function clearTypingLabServiceWorkers(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) => registration.scope.startsWith(window.location.origin))
      .map((registration) => registration.unregister()),
  );

  if (!("caches" in window)) return;

  const cacheKeys = await caches.keys();
  await Promise.all(
    cacheKeys
      .filter((key) => key.startsWith("typinglab-"))
      .map((key) => caches.delete(key)),
  );
}
