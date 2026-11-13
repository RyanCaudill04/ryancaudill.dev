// GET /api/status: whether each project is up, for the lights on the page.
//
// Cloudflare runs this next to the site. It checks each project's public
// health URL (the `health:` fields in content/site.yaml, which the build
// copies to /status-targets.json), so the browser makes no cross-origin
// calls. Answers are cached at the edge for 10 seconds, so many visitors
// become one round of checks.
//
// Admin sits behind Cloudflare Access. To check it, create an Access
// service token, allow it in admin's policy, and set CF_ACCESS_CLIENT_ID
// and CF_ACCESS_CLIENT_SECRET as secrets on the Pages project. Without
// them a login redirect or 401/403 shows as "unknown", not "down".

const ACCESS_HOST = 'admin.ryancaudill.dev';
const TIMEOUT_MS = 2000;
const TTL_SECONDS = 10;

const TEXT = {
  up: 'active (running)',
  sleeping: 'active (sleeping)',
  starting: 'activating',
  down: 'failed',
  unknown: 'not monitored',
};

/** Maps a service's own word for its state onto ours. */
export function fromApp(word) {
  switch (word) {
    case 'active': case 'running': case 'up': case 'ok': return 'up';
    case 'sleeping': return 'sleeping';
    case 'starting': return 'starting';
    case 'offline': case 'stopped': case 'down': return 'down';
  }
  return 'unknown';
}

/** Checks one target: {id, url?, stateField?}. Returns a state name. */
export async function check(target, { fetchFn = fetch } = {}) {
  if (!target.url) return 'unknown';
  let res;
  try {
    res = await fetchFn(target.url, {
      redirect: 'manual', // a redirect is usually a login page, not a health answer
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return 'down'; // refused, timed out, or DNS failed
  }
  // Access (or a login page) answered instead of the service: can't tell.
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
    return 'unknown';
  }
  if (res.status < 200 || res.status > 299) return 'down';
  if (!target.stateField) return 'up';
  try {
    const body = await res.json();
    return fromApp(body?.[target.stateField]);
  } catch {
    return 'unknown';
  }
}

/** Checks every target at once and builds the API's answer. */
export async function report(targets, opts, now = () => new Date()) {
  // Targets that share a URL (play and minecraft) are checked once.
  const byUrl = new Map();
  const states = await Promise.all(targets.map((t) => {
    const key = `${t.url}|${t.stateField}`;
    if (!byUrl.has(key)) byUrl.set(key, check(t, opts));
    return byUrl.get(key);
  }));
  const services = {};
  targets.forEach((t, i) => { services[t.id] = { state: states[i], text: TEXT[states[i]] }; });
  return { checked: now().toISOString(), services };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/status', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const assetRes = await env.ASSETS.fetch(new URL('/status-targets.json', request.url));
  if (!assetRes.ok) return new Response('status targets missing', { status: 500 });
  const targets = await assetRes.json();

  // The service token is for Access-protected hosts only; don't send it to
  // any other health URL.
  const fetchFn = (url, init) => {
    const guarded = env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET && new URL(url).hostname === ACCESS_HOST;
    const headers = guarded
      ? { 'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET }
      : {};
    return fetch(url, { ...init, headers });
  };
  const res = new Response(JSON.stringify(await report(targets, { fetchFn })), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL_SECONDS}` },
  });
  waitUntil(cache.put(key, res.clone()));
  return res;
}
