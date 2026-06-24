/**
 * Local dev-server probe.
 *
 * The IDE itself is served by Vite at `http://localhost:3000` (or similar)
 * on the user's machine. Because both the IDE and the user's frontend dev
 * server live on the same host, the browser is allowed to `fetch` the
 * frontend URL — even cross-origin — using `mode: "no-cors"`. The response
 * is opaque, but a *successful* fetch tells us the server is up and
 * accepting connections. A connection refusal / DNS failure / timeout
 * rejects the promise, which is the signal we use for "offline".
 *
 * This is intentionally minimal: it doesn't read the body, doesn't care
 * about CORS, and doesn't try to be clever about content-type. The only
 * question we answer is: "is anything listening at this URL?".
 */

const DEFAULT_TIMEOUT_MS = 1800;

/**
 * Probe a single URL.
 *
 * Returns `{ ok: true }` when the server responds (even with 404), or
 * `{ ok: false, reason: "timeout" | "refused" | "invalid" }` otherwise.
 */
export async function probeLocalServer(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;
  if (!url || typeof url !== "string") {
    return { ok: false, reason: "invalid" };
  }

  // Compose a private AbortController with the caller's signal so callers
  // can cancel polling loops without us losing the timeout guarantee.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) return { ok: false, reason: "refused" };
    signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    return { ok: true };
  } catch (err) {
    const name = err && err.name;
    return {
      ok: false,
      reason: name === "AbortError" ? "timeout" : "refused",
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Continuously probe a URL on an interval. Returns a `stop()` function.
 *
 * The status callback is invoked with `{ ok, reason, url, checkedAt }`
 * each time a probe completes — including the very first one, which
 * runs immediately so the UI doesn't sit on "unknown" while waiting.
 */
export function watchLocalServer(url, onStatus, options = {}) {
  const { intervalMs = 3000, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  let cancelled = false;
  let timer = null;

  const tick = async () => {
    if (cancelled) return;
    const res = await probeLocalServer(url, { timeoutMs });
    if (cancelled) return;
    try {
      onStatus({ ...res, url, checkedAt: Date.now() });
    } catch { /* ignore listener errors */ }
    timer = setTimeout(tick, intervalMs);
  };

  tick();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * Convenient list of dev-server ports the IDE knows about. Used by the
 * "Detect" button to suggest a working URL when 5173 isn't it.
 */
export const KNOWN_DEV_PORTS = [
  { port: 5173, framework: "Vite" },
  { port: 5174, framework: "Vite (fallback)" },
  { port: 3000, framework: "Next.js / CRA" },
  { port: 3001, framework: "Next.js / CRA (fallback)" },
  { port: 4321, framework: "Astro" },
  { port: 8080, framework: "Generic" },
];

/**
 * Probe a handful of common ports on localhost. Returns the first one
 * that answers, or `null` if none responded within `timeoutMs` each.
 */
export async function detectFirstRunningPort(options = {}) {
  const { timeoutMs = 1200 } = options;
  // Probe sequentially so we return the *earliest* port (5173 first).
  for (const { port, framework } of KNOWN_DEV_PORTS) {
    // eslint-disable-next-line no-await-in-loop
    const res = await probeLocalServer(`http://localhost:${port}`, { timeoutMs });
    if (res.ok) return { port, framework, url: `http://localhost:${port}` };
  }
  return null;
}
