/**
 * In-browser bundler for the workshop frontend.
 *
 * This is the secret sauce that lets users hit "Run in IDE" and see their
 * site without ever opening a terminal. We:
 *
 *   1. Read every file in the detected frontend folder out of the IDE's
 *      in-memory `fileContents` map.
 *   2. Hand them to a sandboxed esbuild-wasm instance with two custom
 *      resolver plugins:
 *        - `workspace-files`  → relative / absolute paths come from RAM
 *        - `cdn-imports`      → bare npm specifiers redirect to esm.sh
 *   3. Splice esbuild's bundled JS (and any CSS it produced) into the
 *      project's existing `index.html`.
 *   4. Wrap the result in a `Blob`, hand back a `blob:` URL the iframe
 *      can frame directly.
 *
 * The whole pipeline runs in the browser — no Node, no terminal, no
 * pre-installed dependencies. esm.sh handles npm package resolution,
 * including subpath imports like `react-dom/client`.
 */

import { detectFrontendRoot, collectFrontendFiles } from "../features/fullstack/fullstackBundler";

/**
 * Latest fullstack-workshop frontend sources from disk. Open workspaces keep
 * stale copies in React state — overlay at bundle time so preview fixes
 * (wallet auto-detect, removed READ_SOURCE_ADDRESS, etc.) apply without
 * forcing users to re-create the project.
 */
const WORKSHOP_FRONTEND_SRC = import.meta.glob(
  "../templates/fullstack-workshop/frontend/src/*.{ts,tsx}",
  { query: "?raw", import: "default", eager: true },
);

/** Strip legacy lines that crash Stellar SDK v13 at module load time. */
const sanitizeLegacyWorkshopSources = (filesMap) => {
  for (const [path, raw] of filesMap.entries()) {
    if (!/\.tsx?$/.test(path) || typeof raw !== "string") continue;
    if (!raw.includes("READ_SOURCE") && !raw.includes("READ_SOURCE_ADDRESS")) continue;
    let next = raw
      .replace(
        /export const READ_SOURCE_ADDRESS = Address\.fromString\(READ_SOURCE\)\.toString\(\);\s*\n?/g,
        "",
      )
      .replace(
        /export const READ_SOURCE = "[^"]*";\s*(?:\/\/[^\n]*)?\n?/g,
        "",
      )
      .replace(/\bREAD_SOURCE,\s*\n/g, "")
      .replace(/import\s*\{\s*Address,\s*\n(\s*Contract,)/, "import {\n$1");
    if (next !== raw) filesMap.set(path, next);
  }
};

/** Replace workshop `src/*` with the latest template when this project is detected. */
const overlayWorkshopFrontendSources = (filesMap) => {
  if (!filesMap.has("src/sorobanClient.ts")) return;
  for (const [key, content] of Object.entries(WORKSHOP_FRONTEND_SRC)) {
    const rel = key.replace(/^.*\/frontend\//, "");
    if (rel.startsWith("src/")) filesMap.set(rel, content);
  }
};

// ── Import classification ────────────────────────────────────────────────
/**
 * Distinguish bare npm specifiers (`react`, `@stellar/stellar-sdk`) from
 * workspace file paths (`src/main.tsx`, `./App.tsx`).
 *
 * The old CDN filter `/^[@a-zA-Z0-9_-]/` incorrectly matched `src/main.tsx`
 * because it starts with `s`, which caused "entry point cannot be marked
 * as external".
 */
const isBareNpmImport = (path) => {
  if (!path || path.startsWith(".") || path.startsWith("/")) return false;
  if (/^https?:\/\//.test(path)) return false;
  const base = path.split("/").pop() || "";
  if (/\.(tsx?|jsx?|mjs|cjs|css|json|html|svg|png|jpe?g|gif|webp|ico|wasm|txt|md)$/i.test(base)) {
    return false;
  }
  return true;
};

// ── esbuild-wasm lazy initializer ────────────────────────────────────────
// Memoize across rebuilds. Also tolerate Vite HMR reloading this module
// while the wasm runtime stays initialized in memory — without that guard
// "Try again" throws "Cannot call initialize more than once".
const ESBUILD_GLOBAL_KEY = "__sorobanEsbuildModule__";
let esbuildInitPromise = null;

async function ensureEsbuild() {
  if (typeof window !== "undefined" && window[ESBUILD_GLOBAL_KEY]) {
    return window[ESBUILD_GLOBAL_KEY];
  }
  if (esbuildInitPromise) return esbuildInitPromise;

  esbuildInitPromise = (async () => {
    const esbuild = await import("esbuild-wasm");
    const wasmUrl = (await import("esbuild-wasm/esbuild.wasm?url")).default;
    try {
      await esbuild.initialize({ wasmURL: wasmUrl, worker: true });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (!/initialize.*more than once/i.test(msg)) throw err;
    }
    if (typeof window !== "undefined") {
      window[ESBUILD_GLOBAL_KEY] = esbuild;
    }
    return esbuild;
  })().catch((err) => {
    esbuildInitPromise = null;
    throw err;
  });
  return esbuildInitPromise;
}

// ── Path helpers ─────────────────────────────────────────────────────────
const EXT_LOADERS = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx",
  mjs: "js", cjs: "js", json: "json", css: "css",
  svg: "text", txt: "text", md: "text",
  png: "dataurl", jpg: "dataurl", jpeg: "dataurl",
  gif: "dataurl", webp: "dataurl", ico: "dataurl",
};

const dirname = (p) => {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
};

/** Normalize "a/b/../c/./d" → "a/c/d". */
const normalizePath = (p) => {
  const parts = p.split("/").filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") { out.pop(); continue; }
    out.push(part);
  }
  return out.join("/");
};

const joinPath = (dir, rel) => normalizePath(`${dir}/${rel}`);

/** Files to try when an import has no extension: `./foo` → `./foo.tsx`, etc. */
const candidatesFor = (base) => [
  base,
  `${base}.ts`,
  `${base}.tsx`,
  `${base}.js`,
  `${base}.jsx`,
  `${base}.mjs`,
  `${base}.cjs`,
  `${base}.json`,
  `${base}.css`,
  `${base}/index.ts`,
  `${base}/index.tsx`,
  `${base}/index.js`,
  `${base}/index.jsx`,
];

// ── Env parsing (for `import.meta.env.VITE_*`) ───────────────────────────
const parseEnv = (text) => {
  const env = {};
  if (!text) return env;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
};

/**
 * Construct the `define` map esbuild applies as a literal string-replace
 * pass. Vite exposes a set of well-known booleans plus every VITE_*
 * variable — we replicate that surface so the user's code doesn't need to
 * know it's running through a different bundler.
 */
const envDefines = (env) => {
  // The catch-all `import.meta.env: "{}"` (and `process.env: "{}"`) is a
  // critical fallback: it ensures that any unknown key access (e.g.
  // `import.meta.env.SOME_TYPO`) compiles to `({}).SOME_TYPO = undefined`
  // instead of a runtime TypeError when `import.meta.env` is undefined.
  // esbuild prefers longer-matching defines, so the specific VITE_* keys
  // below still win when they're set.
  const out = {
    global: "globalThis",
    "import.meta.env": "{}",
    "import.meta.env.MODE": JSON.stringify("development"),
    "import.meta.env.DEV": "true",
    "import.meta.env.PROD": "false",
    "import.meta.env.SSR": "false",
    "import.meta.env.BASE_URL": JSON.stringify("/"),
    // process.env shim so packages built for Node don't blow up.
    "process.env": "{}",
    "process.env.NODE_ENV": JSON.stringify("development"),
  };
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("VITE_")) continue;
    out[`import.meta.env.${key}`] = JSON.stringify(value);
  }
  return out;
};

// ── HTML splicing ────────────────────────────────────────────────────────
/**
 * Small runtime error overlay injected into every preview document. Without
 * this, a failed CDN import or React crash shows up as a blank black iframe
 * with zero feedback in the parent panel.
 */
const PREVIEW_ERROR_BOOTSTRAP = `<script>
(function(){
  function showPreviewError(msg) {
    if (!msg) return;
    var el = document.getElementById("__soroban_preview_err__");
    if (!el) {
      el = document.createElement("div");
      el.id = "__soroban_preview_err__";
      el.style.cssText = "position:fixed;inset:16px;z-index:99999;padding:16px 18px;background:rgba(26,0,0,0.96);border:1px solid #f85149;border-radius:10px;color:#fca5a5;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;overflow:auto;white-space:pre-wrap;pointer-events:auto;";
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = (el.textContent ? el.textContent + "\\n\\n" : "") + msg;
  }
  window.addEventListener("error", function(e) {
    showPreviewError((e.error && e.error.stack) || e.message || "Script error");
  });
  window.addEventListener("unhandledrejection", function(e) {
    var r = e.reason;
    showPreviewError((r && r.stack) || (r && r.message) || String(r || "Unhandled promise rejection"));
  });
})();
</script>`;

/**
 * Replace the Vite entry script with a module `<script src="...">` pointing
 * at a blob URL, inject bundled CSS into `<head>`, and add the error overlay.
 *
 * We deliberately avoid inline module scripts: an external module blob loads
 * CDN imports (esm.sh) reliably, while inline modules + external imports are
 * flaky across browsers.
 */
const composeFinalHtml = (indexHtml, jsModuleUrl, cssContent) => {
  let html = indexHtml;

  const scriptRe = /<script\s+type="module"\s+src="[^"]+"\s*><\/script>/i;
  const moduleScript = `<script type="module" src="${jsModuleUrl}"></script>`;
  if (scriptRe.test(html)) {
    html = html.replace(scriptRe, moduleScript);
  } else if (html.includes("</body>")) {
    html = html.replace("</body>", `${moduleScript}\n</body>`);
  } else {
    html += moduleScript;
  }

  if (cssContent) {
    const styleTag = `<style id="__soroban_preview_css__">\n${cssContent}\n</style>`;
    if (html.includes("</head>")) {
      html = html.replace("</head>", `${styleTag}\n</head>`);
    } else {
      html = styleTag + "\n" + html;
    }
  }

  if (html.includes("</head>")) {
    html = html.replace("</head>", `${PREVIEW_ERROR_BOOTSTRAP}\n</head>`);
  } else {
    html = PREVIEW_ERROR_BOOTSTRAP + "\n" + html;
  }

  return html;
};

/** Strip orphaned CSS imports the bundler may still emit after extraction. */
const stripCssImports = (js) =>
  js.replace(/^\s*import\s+["'][^"']*\.css(?:\?[^"']*)?["'];?\s*$/gm, "");

// ── Main entry point ─────────────────────────────────────────────────────
/**
 * Bundle the user's frontend folder into a single HTML blob URL the
 * Preview iframe can frame directly.
 *
 * Returns `{ blobUrl, html, durationMs, bytes, warnings }` on success.
 * Throws an `Error` with a `.details` array on failure so the UI can
 * render per-file diagnostics.
 */
export async function bundleFrontendInBrowser(treeData, fileContents, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const startedAt = performance.now();

  // 1) Detect frontend folder + collect files
  const detection = detectFrontendRoot(treeData);
  if (!detection.folder) {
    throw new Error("No frontend folder detected — open a project with frontend/ or web/.");
  }
  onProgress({ stage: "collect", message: "Reading workspace files..." });

  const files = collectFrontendFiles(detection.folder, fileContents || {});
  if (files.length === 0) {
    throw new Error("No frontend files found to bundle.");
  }

  const filesMap = new Map();
  let indexHtml = null;
  let envContent = "";
  for (const { path, content } of files) {
    filesMap.set(path, content);
    if (path === "index.html") indexHtml = content;
    if (path === ".env" || path === ".env.local") envContent = content;
  }

  overlayWorkshopFrontendSources(filesMap);
  sanitizeLegacyWorkshopSources(filesMap);

  if (!indexHtml) {
    throw new Error(
      "index.html not found at the frontend root — the bundler needs one to know where to start.",
    );
  }

  // 2) Find the entry script declared in index.html (Vite convention).
  const scriptMatch = indexHtml.match(/<script\s+type="module"\s+src="([^"]+)"\s*><\/script>/i);
  if (!scriptMatch) {
    throw new Error(
      'index.html must contain a <script type="module" src="..."></script> tag pointing at your entry file.',
    );
  }
  const entryRaw = scriptMatch[1];
  const entrySrc = entryRaw.startsWith("/") ? entryRaw.slice(1) : entryRaw;
  if (!filesMap.has(entrySrc)) {
    // Try resolving with extensions in case the tag points at a folder.
    const found = candidatesFor(entrySrc).find((c) => filesMap.has(c));
    if (!found) {
      throw new Error(`Entry script "${entryRaw}" was referenced by index.html but isn't in the workspace.`);
    }
  }
  const entry = filesMap.has(entrySrc)
    ? entrySrc
    : candidatesFor(entrySrc).find((c) => filesMap.has(c));

  onProgress({ stage: "init", message: "Booting bundler (esbuild-wasm)..." });
  const esbuild = await ensureEsbuild();

  onProgress({ stage: "bundle", message: "Compiling sources & resolving npm imports..." });

  const env = parseEnv(envContent);
  if (options.walletAddress) {
    env.VITE_WALLET_ADDRESS = options.walletAddress;
  }
  if (options.contractId !== undefined) {
    env.VITE_CONTRACT_ID = options.contractId;
  }
  if (options.network) {
    env.VITE_NETWORK = options.network;
  }
  if (env.VITE_CONTRACT_ID && env.VITE_CONTRACT_ID.startsWith("G")) {
    throw new Error(
      "VITE_CONTRACT_ID looks like a wallet address (starts with G). "
      + "Use the contract ID from the Deploy panel (starts with C). "
      + "Wallet addresses belong in Freighter / VITE_WALLET_ADDRESS, not VITE_CONTRACT_ID.",
    );
  }

  let result;
  try {
    result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      target: "es2020",
      sourcemap: "inline",
      jsx: "automatic",
      define: envDefines(env),
      loader: {
        ".svg": "text",
        ".png": "dataurl",
        ".jpg": "dataurl",
        ".jpeg": "dataurl",
        ".gif": "dataurl",
        ".webp": "dataurl",
        ".ico": "dataurl",
      },
      plugins: [workspacePlugin(filesMap), cdnShimPlugin(filesMap), cdnPlugin(filesMap)],
    });
  } catch (err) {
    // esbuild surfaces parse / resolution errors as thrown Errors with
    // `errors[]`. Capture them on `.details` so the UI can list each.
    const wrapped = new Error(
      err && err.message ? err.message : "Bundle failed",
    );
    wrapped.details = err && err.errors ? err.errors : [];
    throw wrapped;
  }

  if (result.errors && result.errors.length > 0) {
    const wrapped = new Error(result.errors[0].text || "Bundle failed");
    wrapped.details = result.errors;
    throw wrapped;
  }

  let jsContent = "";
  let cssContent = "";
  for (const file of result.outputFiles || []) {
    if (file.path.endsWith(".css")) cssContent += file.text + "\n";
    else jsContent += file.text + "\n";
  }
  jsContent = stripCssImports(jsContent);

  onProgress({ stage: "compose", message: "Assembling preview..." });

  const jsBlobUrl = URL.createObjectURL(
    new Blob([jsContent], { type: "text/javascript" }),
  );
  const finalHtml = composeFinalHtml(indexHtml, jsBlobUrl, cssContent);

  const blob = new Blob([finalHtml], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);

  const durationMs = performance.now() - startedAt;
  return {
    blobUrl,
    /** Extra blob URLs that must be revoked alongside blobUrl on rebuild. */
    auxBlobUrls: [jsBlobUrl],
    html: finalHtml,
    durationMs,
    bytes: finalHtml.length,
    warnings: result.warnings || [],
    entry,
  };
}

// ── Plugins ──────────────────────────────────────────────────────────────

/**
 * Resolves `./foo`, `../foo`, `/foo` against the in-memory file map.
 * Bare specifiers fall through to the CDN plugin.
 */
function workspacePlugin(filesMap) {
  return {
    name: "workspace-files",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (/^https?:\/\//.test(args.path)) return null;
        if (isBareNpmImport(args.path)) return null;

        let baseCandidate;
        if (args.path.startsWith("/")) {
          baseCandidate = args.path.slice(1);
        } else if (args.importer && (args.path.startsWith("./") || args.path.startsWith("../"))) {
          baseCandidate = joinPath(dirname(args.importer), args.path);
        } else if (args.importer) {
          // Bare-looking path from an importer, e.g. import App from "App"
          baseCandidate = joinPath(dirname(args.importer), args.path);
        } else {
          // Entry point from index.html, e.g. src/main.tsx
          baseCandidate = args.path;
        }

        for (const c of candidatesFor(baseCandidate)) {
          if (filesMap.has(c)) {
            return { path: c, namespace: "workspace" };
          }
        }
        return {
          errors: [{
            text: `Cannot resolve "${args.path}"${args.importer ? ` from ${args.importer}` : ""}`,
          }],
        };
      });

      build.onLoad({ filter: /.*/, namespace: "workspace" }, (args) => {
        const content = filesMap.get(args.path);
        if (content == null) {
          return { errors: [{ text: `File disappeared while loading: ${args.path}` }] };
        }
        const ext = (args.path.match(/\.([^./]+)$/) || ["", ""])[1].toLowerCase();

        // Turn CSS imports into JS that injects a <style> tag. Extracting
        // CSS to a separate file leaves `import "./foo.css"` in the JS
        // output, which 404s inside a blob preview and kills the whole
        // module graph silently (black iframe).
        if (ext === "css") {
          return {
            contents: [
              "(function(){",
              "  var s = document.createElement('style');",
              `  s.setAttribute('data-file', ${JSON.stringify(args.path)});`,
              `  s.textContent = ${JSON.stringify(content)};`,
              "  document.head.appendChild(s);",
              "})();",
            ].join("\n"),
            loader: "js",
          };
        }

        const loader = EXT_LOADERS[ext] || "text";
        return { contents: content, loader };
      });
    },
  };
}

/**
 * Parse an npm import specifier into { pkgName, subpath }.
 *   react-dom/client  → { pkgName: "react-dom", subpath: "/client" }
 *   @stellar/freighter-api → { pkgName: "@stellar/freighter-api", subpath: "" }
 *
 * IMPORTANT: scoped packages use TWO path segments for pkgName. The old
 * `indexOf("/", 1)` approach returned "@stellar" for "@stellar/freighter-api",
 * which broke version pinning and the exports= lookup entirely.
 */
const parseNpmSpec = (spec) => {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    if (parts.length < 2) return { pkgName: spec, subpath: "" };
    return {
      pkgName: `${parts[0]}/${parts[1]}`,
      subpath: parts.length > 2 ? `/${parts.slice(2).join("/")}` : "",
    };
  }
  const slash = spec.indexOf("/");
  if (slash === -1) return { pkgName: spec, subpath: "" };
  return { pkgName: spec.slice(0, slash), subpath: spec.slice(slash) };
};

const readPkgVersions = (filesMap) => {
  const rawPkg = filesMap.get("package.json");
  if (!rawPkg) return {};
  try {
    const pkg = JSON.parse(rawPkg);
    return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  } catch {
    return {};
  }
};

const pinNpmSpec = (spec, pkgVersions) => {
  const { pkgName, subpath } = parseNpmSpec(spec);
  const range = pkgVersions[pkgName];
  if (!range) return spec;
  const ver = String(range).replace(/^[\^~>=<]+/, "").split(" ")[0];
  return `${pkgName}@${ver}${subpath}`;
};

const buildEsmShUrl = (spec, pkgVersions, { exports } = {}) => {
  const pinned = pinNpmSpec(spec, pkgVersions);
  const params = new URLSearchParams({ target: "es2020" });
  params.set("dev", "");
  if (exports) params.set("exports", exports);
  return `https://esm.sh/${pinned}?${params.toString()}`;
};

/**
 * Packages that esm.sh only exposes as a default export (CJS interop).
 * We bundle a tiny shim that default-imports from esm.sh and re-exports
 * named bindings so `{ getAddress }` imports work in the final output.
 */
const CDN_SHIM_EXPORTS = {
  "@stellar/freighter-api": [
    "getAddress", "isConnected", "requestAccess", "signTransaction",
    "signMessage", "signAuthEntry", "getNetwork", "getNetworkDetails",
    "isAllowed", "setAllowed", "addToken", "WatchWalletChanges",
  ],
  "@stellar/stellar-sdk": [
    "Address", "BASE_FEE", "Contract", "Networks", "TransactionBuilder",
    "rpc", "xdr", "scValToNative", "Keypair", "Horizon", "StrKey",
    "Transaction", "Account", "Operation", "Asset", "Memo",
    "nativeToScVal", "scValToBigInt",
  ],
};

/**
 * Virtual modules for default-only CDN packages. esbuild inlines these into
 * the bundle so runtime code never does `import { x } from "https://esm.sh/…"`.
 */
function cdnShimPlugin(filesMap) {
  const pkgVersions = readPkgVersions(filesMap);

  return {
    name: "cdn-shim",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!isBareNpmImport(args.path)) return null;
        const { pkgName } = parseNpmSpec(args.path);
        if (!CDN_SHIM_EXPORTS[pkgName]) return null;
        return { path: args.path, namespace: "cdn-shim" };
      });

      build.onLoad({ filter: /.*/, namespace: "cdn-shim" }, (args) => {
        const { pkgName } = parseNpmSpec(args.path);
        const exportNames = CDN_SHIM_EXPORTS[pkgName] || [];
        const url = buildEsmShUrl(args.path, pkgVersions);
        const lines = [
          `import __pkg from ${JSON.stringify(url)};`,
          ...exportNames.map((name) => `export const ${name} = __pkg[${JSON.stringify(name)}];`),
          "export default __pkg;",
        ];
        return { contents: lines.join("\n"), loader: "js" };
      });
    },
  };
}

/**
 * External CDN imports for packages with native ESM named exports (react, etc.).
 * Shimmed packages are skipped — cdnShimPlugin handles those.
 */
function cdnPlugin(filesMap) {
  const pkgVersions = readPkgVersions(filesMap);

  return {
    name: "cdn-imports",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!isBareNpmImport(args.path)) return null;
        const { pkgName } = parseNpmSpec(args.path);
        if (CDN_SHIM_EXPORTS[pkgName]) return null;
        return {
          path: buildEsmShUrl(args.path, pkgVersions),
          external: true,
        };
      });
    },
  };
}
