const CACHE_NAME = "typinglab-v3";
const APP_SHELL = ["/manifest.webmanifest", "/icon.svg"];
const ASSET_PREFIX = "/assets/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirstAsset(request));
    return;
  }

  event.respondWith(cacheFirstStatic(request));
});

async function networkFirstHtml(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (isCacheableBasicResponse(response)) {
      const responseForCache = response.clone();
      const responseForCleanup = response.clone();
      await cache.put("/index.html", responseForCache);
      await cleanupOutdatedCachedAssets(cache, responseForCleanup);
    }
    return response;
  } catch {
    return (await cache.match("/index.html")) ?? Response.error();
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (!isCacheableBasicResponse(response) || isHtmlResponse(response)) {
    return response;
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function cleanupOutdatedCachedAssets(cache, htmlResponse) {
  if (!isHtmlResponse(htmlResponse)) return;

  const currentAssets = collectAssetPathsFromHtml(await htmlResponse.text());
  if (currentAssets.size === 0) return;

  const cachedRequests = await cache.keys();
  await Promise.all(
    cachedRequests.map((cachedRequest) => {
      const url = new URL(cachedRequest.url);
      if (
        url.origin === self.location.origin &&
        url.pathname.startsWith(ASSET_PREFIX) &&
        !currentAssets.has(url.pathname)
      ) {
        return cache.delete(cachedRequest);
      }
      return undefined;
    }),
  );
}

function collectAssetPathsFromHtml(html) {
  const assets = new Set();
  const attributePattern = /(?:src|href)=["']([^"']+)["']/g;
  let match = attributePattern.exec(html);

  while (match) {
    try {
      const url = new URL(match[1], self.location.origin);
      if (url.origin === self.location.origin && url.pathname.startsWith(ASSET_PREFIX)) {
        assets.add(url.pathname);
      }
    } catch {
      // Ignore malformed attribute values.
    }
    match = attributePattern.exec(html);
  }

  return assets;
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheableBasicResponse(response) && !isHtmlResponse(response)) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

function isCacheableBasicResponse(response) {
  return response && response.status === 200 && response.type === "basic";
}

function isHtmlResponse(response) {
  return response.headers.get("content-type")?.includes("text/html") ?? false;
}
