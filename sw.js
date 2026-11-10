/* Kikoeru static replica: intercept /api/* and serve local JSON. Frontend unchanged. */
const VERSION = "v5";
const CACHE = "kikoeru-data-" + VERSION;
const PRELOAD = [
  "data/shared.json",
  "data/works.json",
  "data/tags.json",
  "data/circles.json",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(PRELOAD.map((p) => c.add(p).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function loadJson(path) {
  const c = await caches.open(CACHE);
  let r = await c.match(path, { ignoreSearch: true });
  if (!r) {
    r = await fetch(path, { cache: "no-store" });
    if (r.ok) c.put(path, r.clone());
  }
  if (!r || !r.ok) return null;
  try { return await r.json(); } catch (e) { return null; }
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/api/")) return;
  ev.respondWith(handleApi(url, ev).catch((e) => jsonResp({ error: String(e) }, 500)));
});

async function handleApi(u, ev) {
  const p = u.pathname;
  const q = u.searchParams;
  const method = (ev && ev.request && ev.request.method) || "GET";

  if (p === "/api/config/shared") {
    const d = await loadJson("data/shared.json");
    return jsonResp(d || { sharedConfig: {} });
  }

  if (p === "/api/version") {
    return jsonResp({ update_available: false, notifyUser: false, version: "static" });
  }

  if (p === "/api/histroy") {
    if (method === "PUT") return jsonResp({ success: true });
    return jsonResp({ playHistory: [], pagination: { currentPage: 1, pageSize: 20, totalCount: 0 } });
  }

  if (p === "/api/review") {
    return jsonResp({ reviews: [], pagination: { currentPage: 1, pageSize: 20, totalCount: 0 } });
  }

  if (p === "/api/auth/me") {
    if (method === "POST") return jsonResp({ error: "static build: login disabled" }, 401);
    return jsonResp({ user: { name: "guest", group: "guest" }, auth: false, guestMode: true });
  }

  if (p === "/api/works" || p === "/api/search") {
    const d = await loadJson("data/works.json");
    if (!d) return jsonResp({ works: [], pagination: { currentPage: 1, pageSize: 24, totalCount: 0 } });
    let works = d.works || [];
    const page = parseInt(q.get("page") || "1", 10) || 1;
    const size = parseInt(q.get("pageSize") || "24", 10) || 24;
    const keyword = (q.get("keyword") || "").trim().toLowerCase();
    if (keyword) works = works.filter((w) => (w.title || "").toLowerCase().includes(keyword));
    const total = works.length;
    const start = (page - 1) * size;
    return jsonResp({
      works: works.slice(start, start + size),
      pagination: { currentPage: page, pageSize: size, totalCount: total },
    });
  }

  if (p === "/api/tags") {
    const d = await loadJson("data/tags.json");
    return jsonResp(d || []);
  }

  if (p === "/api/circles") {
    const d = await loadJson("data/circles.json");
    return jsonResp(d || []);
  }

  let m = p.match(/^\/api\/work\/(\d+)$/);
  if (m) {
    const id = m[1];
    const direct = await loadJson("data/work_" + id + ".json");
    if (direct) return jsonResp(direct);
    const d = await loadJson("data/works.json");
    const w = ((d && d.works) || []).find((x) => String(x.id) === id);
    return w ? jsonResp(w) : jsonResp({ error: "not found" }, 404);
  }

  m = p.match(/^\/api\/tracks\/(\d+)$/);
  if (m) {
    const d = await loadJson("data/tracks_" + m[1] + ".json");
    return jsonResp(d || []);
  }

  if (p.startsWith("/api/cover/")) {
    /* serve local cover files downloaded into data/covers/<id>.jpg */
    const cm = p.match(/^\/api\/cover\/(\d+)/);
    if (cm) {
      try {
        const r = await fetch("data/covers/" + cm[1] + ".jpg");
        if (r.ok) {
          return new Response(r.body, {
            status: 200,
            headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=604800" },
          });
        }
      } catch (e) { }
    }
    return new Response("", { status: 404 });
  }

  if (p.startsWith("/api/media/")) {
    const d = await loadJson("data/shared.json");
    const base = (d && d.sharedConfig && d.sharedConfig.mediaFileBaseUrl) || "";
    if (base) return Response.redirect(base + p, 302);
    return new Response("", { status: 404 });
  }

  /* unimplemented endpoints: empty object so the frontend keeps going */
  return jsonResp({});
}

