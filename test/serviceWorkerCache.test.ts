import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

interface ServiceWorkerTestContext {
  collectAssetPathsFromHtml: (html: string) => Set<string>;
  cleanupOutdatedCachedAssets: (
    cache: {
      keys: () => Promise<Request[]>;
      delete: (request: Request) => Promise<boolean>;
    },
    htmlResponse: Response,
  ) => Promise<void>;
}

function loadServiceWorkerContext(): ServiceWorkerTestContext {
  const script = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
  const context = {
    console,
    URL,
    Response,
    Request,
    Set,
    Promise,
    fetch,
    caches: {
      keys: async () => [],
      match: async () => undefined,
      open: async () => ({
        addAll: async () => undefined,
        put: async () => undefined,
        keys: async () => [],
        delete: async () => true,
      }),
      delete: async () => true,
    },
    self: {
      location: {
        origin: "http://127.0.0.1:5173",
      },
      clients: {
        claim: async () => undefined,
      },
      skipWaiting: async () => undefined,
      addEventListener: () => undefined,
    },
  };

  vm.createContext(context);
  vm.runInContext(script, context);
  return context as unknown as ServiceWorkerTestContext;
}

describe("service worker cache hygiene", () => {
  it("extracts only same-origin build assets referenced by the latest HTML", () => {
    const sw = loadServiceWorkerContext();

    const assets = sw.collectAssetPathsFromHtml(`
      <link rel="stylesheet" href="/assets/index-current.css">
      <script type="module" src="/assets/index-current.js"></script>
      <script src="https://example.com/assets/ignore.js"></script>
      <link rel="icon" href="/icon.svg">
    `);

    expect([...assets].sort()).toEqual([
      "/assets/index-current.css",
      "/assets/index-current.js",
    ]);
  });

  it("deletes cached build assets that are no longer referenced by the latest HTML", async () => {
    const sw = loadServiceWorkerContext();
    const deletedPaths: string[] = [];
    const cachedRequests = [
      new Request("http://127.0.0.1:5173/assets/index-old.js"),
      new Request("http://127.0.0.1:5173/assets/index-current.js"),
      new Request("http://127.0.0.1:5173/icon.svg"),
    ];
    const cache = {
      keys: async () => cachedRequests,
      delete: async (request: Request) => {
        deletedPaths.push(new URL(request.url).pathname);
        return true;
      },
    };

    await sw.cleanupOutdatedCachedAssets(
      cache,
      new Response('<script type="module" src="/assets/index-current.js"></script>', {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      }),
    );

    expect(deletedPaths).toEqual(["/assets/index-old.js"]);
  });
});
