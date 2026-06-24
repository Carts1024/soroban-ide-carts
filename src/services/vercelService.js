/**
 * Vercel REST API client.
 *
 * All calls go directly from the browser using a bearer access token
 * (either from OAuth via the Go backend or a pasted Personal Access Token).
 *
 * Vercel API reference: https://vercel.com/docs/rest-api
 */

const VERCEL_API = "https://api.vercel.com";

/**
 * Append `teamId` as a query string when present. Vercel scopes most reads
 * by team via this single parameter.
 */
const withTeam = (url, teamId) => {
  if (!teamId) return url;
  return `${url}${url.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(teamId)}`;
};

const authHeaders = (token, extra = {}) => ({
  Authorization: `Bearer ${token}`,
  ...extra,
});

/**
 * Wrap fetch with consistent error handling. Vercel error bodies are shaped
 * `{ error: { code, message } }` so we surface `.message` when present.
 */
const vfetch = async (url, init = {}) => {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.message || body?.message || JSON.stringify(body);
    } catch {
      try { detail = await res.text(); } catch { /* ignore */ }
    }
    const err = new Error(detail || `Vercel API ${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
};

// ─── Identity ────────────────────────────────────────────────────────────────

/** GET /v2/user — current user from token. */
export const getUser = (token) =>
  vfetch(`${VERCEL_API}/v2/user`, { headers: authHeaders(token) })
    .then((r) => r?.user || r);

/** GET /v2/teams — teams the token can access. */
export const listTeams = (token) =>
  vfetch(`${VERCEL_API}/v2/teams?limit=100`, { headers: authHeaders(token) })
    .then((r) => r?.teams || []);

// ─── Projects ────────────────────────────────────────────────────────────────

/** GET /v9/projects — list projects for user/team. */
export const listProjects = (token, teamId) =>
  vfetch(withTeam(`${VERCEL_API}/v9/projects?limit=100`, teamId), {
    headers: authHeaders(token),
  }).then((r) => r?.projects || []);

/** POST /v10/projects — create a new project. Useful when deploying a workspace
 *  that has never been pushed to Vercel before. */
export const createProject = (token, teamId, name, framework = null) =>
  vfetch(withTeam(`${VERCEL_API}/v10/projects`, teamId), {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name, framework }),
  });

// ─── Deployments ─────────────────────────────────────────────────────────────

/** GET /v6/deployments?projectId=... — list recent deployments. */
export const listDeployments = (token, teamId, projectId, limit = 20) => {
  const url = `${VERCEL_API}/v6/deployments?limit=${limit}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`;
  return vfetch(withTeam(url, teamId), { headers: authHeaders(token) })
    .then((r) => r?.deployments || []);
};

/** GET /v13/deployments/:id — full deployment record. */
export const getDeployment = (token, teamId, deploymentId) =>
  vfetch(withTeam(`${VERCEL_API}/v13/deployments/${encodeURIComponent(deploymentId)}`, teamId), {
    headers: authHeaders(token),
  });

/** GET /v3/deployments/:id/events — build/runtime log events.
 *  Returns an array of `{ type, payload, created, ... }` entries.
 */
export const getDeploymentEvents = (token, teamId, deploymentId, since = null) => {
  let url = `${VERCEL_API}/v3/deployments/${encodeURIComponent(deploymentId)}/events?builds=1`;
  if (since) url += `&since=${since}`;
  return vfetch(withTeam(url, teamId), { headers: authHeaders(token) });
};

/** DELETE /v13/deployments/:id — cancel/delete a deployment. */
export const cancelDeployment = (token, teamId, deploymentId) =>
  vfetch(withTeam(`${VERCEL_API}/v13/deployments/${encodeURIComponent(deploymentId)}`, teamId), {
    method: "DELETE",
    headers: authHeaders(token),
  });

// ─── File upload (deploy bundle) ─────────────────────────────────────────────

/**
 * POST /v2/files — upload a single file blob.
 * Vercel deduplicates by SHA1; the body is the raw file bytes (or text)
 * and the SHA1 is sent in the `x-vercel-digest` header.
 *
 * `data` may be a string (utf-8) or a Uint8Array / ArrayBuffer.
 */
export const uploadFile = async (token, teamId, sha, size, data) => {
  const url = withTeam(`${VERCEL_API}/v2/files`, teamId);
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(token, {
      "Content-Type": "application/octet-stream",
      "x-vercel-digest": sha,
      "Content-Length": String(size),
    }),
    body: data,
  });
  // 200/409 are both fine: 409 just means the blob already exists server-side.
  if (!res.ok && res.status !== 409) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
    throw new Error(detail || `Upload failed (${res.status})`);
  }
  return { sha, size };
};

/**
 * Upload many files with bounded concurrency. Calls `onProgress(done, total)`
 * after each completion so the UI can render a progress bar.
 */
export const uploadFiles = async (token, teamId, entries, onProgress, concurrency = 4) => {
  const total = entries.length;
  let done = 0;
  let cursor = 0;
  const errors = [];

  const worker = async () => {
    while (cursor < entries.length) {
      const idx = cursor++;
      const entry = entries[idx];
      try {
        await uploadFile(token, teamId, entry.sha, entry.size, entry.data);
      } catch (err) {
        errors.push({ file: entry.file, error: err.message });
      }
      done += 1;
      onProgress?.(done, total);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total || 1) }, worker));
  if (errors.length) {
    const e = new Error(`Failed to upload ${errors.length}/${total} file(s): ${errors[0].file} — ${errors[0].error}`);
    e.details = errors;
    throw e;
  }
};

/**
 * POST /v13/deployments — create a deployment from uploaded file references.
 *
 * `files` is an array of `{ file, sha, size }` (the `data` field is omitted —
 * Vercel resolves bytes server-side via SHA1).
 */
export const createDeployment = (token, teamId, params) => {
  const {
    name,            // project name
    projectId,       // optional, attaches to existing project
    files,           // [{ file, sha, size }]
    target = null,   // "production" | "staging" | null (preview)
    env = {},        // { KEY: "value" }
    framework = null,
    gitMetadata = null,
  } = params;

  const body = {
    name,
    files,
    projectSettings: framework ? { framework } : undefined,
    target,
    env,
    meta: {
      source: "soroban-ide",
      ...(gitMetadata || {}),
    },
  };
  if (projectId) body.project = projectId;

  return vfetch(withTeam(`${VERCEL_API}/v13/deployments?forceNew=1`, teamId), {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
};

/**
 * Poll `getDeployment` until the state is terminal (READY / ERROR / CANCELED).
 * Resolves with the final deployment record. `onTick` is called with each
 * polled record so the UI can update intermediate state.
 */
export const pollDeployment = async (token, teamId, deploymentId, { intervalMs = 2000, timeoutMs = 10 * 60 * 1000, onTick } = {}) => {
  const start = Date.now();
  while (true) {
    const dep = await getDeployment(token, teamId, deploymentId);
    onTick?.(dep);
    const state = dep?.readyState || dep?.status;
    if (state === "READY" || state === "ERROR" || state === "CANCELED") {
      return dep;
    }
    if (Date.now() - start > timeoutMs) {
      const e = new Error(`Deployment polling timed out after ${Math.round(timeoutMs / 1000)}s`);
      e.deployment = dep;
      throw e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convenience: validate a token by attempting to fetch /v2/user. */
export const verifyToken = async (token) => {
  try {
    const user = await getUser(token);
    return { ok: true, user };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};
