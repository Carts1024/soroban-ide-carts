import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Monitor,
  Smartphone,
  Tablet,
  RefreshCw,
  ExternalLink,
  Globe,
  Laptop2,
  AlertCircle,
  Download,
  Rocket,
  Loader,
  CheckCircle,
  Sparkles,
  Play,
  Settings2,
  Zap,
  Wallet,
  FileCode,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { detectFrontendRoot } from "../fullstack/fullstackBundler";
import { downloadFrontendZip } from "./downloadFrontend";
import { watchLocalServer } from "../../services/localServerProbe";
import { bundleFrontendInBrowser } from "../../services/inBrowserBundler";
import { useContract } from "../../context/ContractContext";
import { useDeploy } from "../../context/DeployContext";
import { getLatestDeployedContract, toViteNetwork } from "../deploy/deploymentHistory";
import {
  fingerprintFrontend,
  BUILD_STAGE_ORDER,
  BUILD_STAGE_LABELS,
  BUILD_STAGE_PROGRESS,
  shortContractId,
} from "./previewUtils";

const LAST_VERCEL_URL_KEY = "soroban.lastVercelUrl";
const LAST_LOCAL_URL_KEY = "soroban.lastLocalPreviewUrl";
const LOCAL_MODE_KEY = "soroban.localPreviewMode"; // "in-ide" | "external"
const AUTO_LIVE_KEY = "soroban.previewAutoLive";
const DEFAULT_LOCAL_URL = "http://localhost:5173";

const DEVICE_PRESETS = [
  { id: "desktop", label: "Desktop", icon: Monitor, width: null },
  { id: "tablet", label: "Tablet", icon: Tablet, width: 768 },
  { id: "mobile", label: "Mobile", icon: Smartphone, width: 390 },
];

const normalizeUrl = (raw) => {
  const v = (raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `http://${v}`;
};

const PreviewPanel = ({ treeData, fileContents, isActive = true }) => {
  const { walletAddress, contractId, connectWallet } = useContract();
  const { deploymentHistory } = useDeploy();
  const detection = useMemo(() => detectFrontendRoot(treeData), [treeData]);

  const previewContract = useMemo(() => {
    if (contractId?.startsWith("C")) {
      const fromHistory = Object.values(deploymentHistory || {})
        .flat()
        .find((d) => d.id === contractId);
      return {
        contractId,
        network: toViteNetwork(fromHistory?.network),
      };
    }
    return getLatestDeployedContract(deploymentHistory);
  }, [contractId, deploymentHistory]);

  // "local" (in-IDE bundle or external URL) | "deployed" (Vercel)
  const [source, setSource] = useState("local");

  // Within the Local source, two execution modes:
  //   "in-ide"   — bundle the workspace into a blob and frame it (default)
  //   "external" — frame a custom localhost URL (power-user fallback)
  const [localMode, setLocalMode] = useState(() => {
    try { return localStorage.getItem(LOCAL_MODE_KEY) || "in-ide"; }
    catch { return "in-ide"; }
  });
  useEffect(() => {
    try { localStorage.setItem(LOCAL_MODE_KEY, localMode); } catch { /* ignore */ }
  }, [localMode]);

  const [localUrl, setLocalUrl] = useState(() => {
    try { return localStorage.getItem(LAST_LOCAL_URL_KEY) || DEFAULT_LOCAL_URL; }
    catch { return DEFAULT_LOCAL_URL; }
  });
  const [deployedUrl, setDeployedUrl] = useState(() => {
    try { return localStorage.getItem(LAST_VERCEL_URL_KEY) || ""; }
    catch { return ""; }
  });

  const [deviceId, setDeviceId] = useState("desktop");
  const [reloadCounter, setReloadCounter] = useState(0);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [downloadState, setDownloadState] = useState({ kind: "idle" });
  const [externalStatus, setExternalStatus] = useState({ phase: "checking" });

  // In-IDE bundle state.
  // phase: "idle" | "building" | "ready" | "error"
  const [buildState, setBuildState] = useState({ phase: "idle" });
  const [autoLive, setAutoLive] = useState(() => {
    try { return localStorage.getItem(AUTO_LIVE_KEY) !== "false"; }
    catch { return true; }
  });
  const [hintsOpen, setHintsOpen] = useState(false);
  const blobUrlRef = useRef(null);
  const auxBlobUrlsRef = useRef([]);
  const iframeRef = useRef(null);
  const lastBuiltFingerprintRef = useRef("");
  const buildInFlightRef = useRef(false);
  const frontendFingerprint = useMemo(
    () => fingerprintFrontend(detection, fileContents),
    [detection, fileContents],
  );

  useEffect(() => {
    try { localStorage.setItem(AUTO_LIVE_KEY, autoLive ? "true" : "false"); }
    catch { /* ignore */ }
  }, [autoLive]);

  // ─── Persistence + cross-tab sync ─────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(LAST_LOCAL_URL_KEY, localUrl); } catch { /* ignore */ }
  }, [localUrl]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === LAST_VERCEL_URL_KEY) setDeployedUrl(e.newValue || "");
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // ─── Bundle action ────────────────────────────────────────────────────
  // Revoke every blob URL from the previous build (HTML + JS module) so we
  // don't leak memory across rebuilds.
  const setPreviewBlobs = useCallback((htmlUrl, auxUrls = []) => {
    for (const url of auxBlobUrlsRef.current) {
      if (url && url !== htmlUrl && !auxUrls.includes(url)) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      }
    }
    if (blobUrlRef.current && blobUrlRef.current !== htmlUrl) {
      try { URL.revokeObjectURL(blobUrlRef.current); } catch { /* ignore */ }
    }
    blobUrlRef.current = htmlUrl || null;
    auxBlobUrlsRef.current = auxUrls.filter(Boolean);
  }, []);

  const postWalletToIframe = useCallback(() => {
    if (!walletAddress || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { source: "soroban-ide", type: "soroban:wallet", address: walletAddress },
      "*",
    );
  }, [walletAddress]);

  const handleIframeLoad = useCallback(() => {
    setLoadedOnce(true);
    postWalletToIframe();
  }, [postWalletToIframe]);

  // Push wallet updates into the preview when the Deploy panel connects
  // or switches accounts — blob iframes can't talk to Freighter directly.
  useEffect(() => {
    postWalletToIframe();
  }, [walletAddress, buildState.phase, reloadCounter, postWalletToIframe]);

  const runBuild = useCallback(async () => {
    if (buildInFlightRef.current) return;
    buildInFlightRef.current = true;
    setBuildState({ phase: "building", stage: "collect", message: "Reading workspace files..." });
    setLoadedOnce(false);
    try {
      const result = await bundleFrontendInBrowser(treeData, fileContents, {
        onProgress: (p) => {
          setBuildState({ phase: "building", stage: p.stage, message: p.message });
        },
        walletAddress: walletAddress || undefined,
        contractId: previewContract?.contractId,
        network: previewContract?.network,
      });
      setPreviewBlobs(result.blobUrl, result.auxBlobUrls);
      lastBuiltFingerprintRef.current = frontendFingerprint;
      setBuildState({
        phase: "ready",
        blobUrl: result.blobUrl,
        durationMs: result.durationMs,
        bytes: result.bytes,
        warnings: result.warnings,
        entry: result.entry,
      });
      setReloadCounter((n) => n + 1);
    } catch (err) {
      setBuildState({
        phase: "error",
        message: err && err.message ? err.message : String(err),
        details: err && err.details ? err.details : [],
      });
    } finally {
      buildInFlightRef.current = false;
    }
  }, [treeData, fileContents, walletAddress, previewContract, frontendFingerprint, setPreviewBlobs]);

  // Listen for "soroban:runInIdeBuild" — opens preview (via Sidebar) then builds.
  useEffect(() => {
    const handler = () => {
      setSource("local");
      setLocalMode("in-ide");
      runBuild();
    };
    window.addEventListener("soroban:runInIdeBuild", handler);
    return () => window.removeEventListener("soroban:runInIdeBuild", handler);
  }, [runBuild]);

  // Live rebuild — when frontend files change and a preview is already running.
  useEffect(() => {
    if (!autoLive || source !== "local" || localMode !== "in-ide") return undefined;
    if (buildState.phase !== "ready" || !frontendFingerprint) return undefined;
    if (!lastBuiltFingerprintRef.current) {
      lastBuiltFingerprintRef.current = frontendFingerprint;
      return undefined;
    }
    if (lastBuiltFingerprintRef.current === frontendFingerprint) return undefined;
    const timer = setTimeout(() => runBuild(), 500);
    return () => clearTimeout(timer);
  }, [autoLive, source, localMode, buildState.phase, frontendFingerprint, runBuild]);

  // ⌘/Ctrl+Shift+B — quick rebuild while the preview panel is open.
  useEffect(() => {
    if (!isActive) return undefined;
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== "b") return;
      if (source !== "local" || localMode !== "in-ide") return;
      e.preventDefault();
      runBuild();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, source, localMode, runBuild]);

  const openPanel = useCallback((panel) => {
    window.dispatchEvent(new CustomEvent("soroban:setSidebarPanel", { detail: { panel } }));
  }, []);

  // Listen for Vercel deploys → flip to Deployed automatically.
  useEffect(() => {
    const handler = (e) => {
      const url = e.detail?.url || "";
      if (!url) return;
      setDeployedUrl(url);
      setSource("deployed");
      setLoadedOnce(false);
      setReloadCounter((n) => n + 1);
    };
    window.addEventListener("soroban:vercelDeployUrl", handler);
    return () => window.removeEventListener("soroban:vercelDeployUrl", handler);
  }, []);

  // Listen for the legacy "open Preview at a URL" event from LocalDeployView's
  // external-URL helper. We keep this for advanced users with their own
  // dev server running.
  useEffect(() => {
    const handler = (e) => {
      const url = e.detail?.url;
      if (typeof url === "string" && url.trim()) {
        setLocalUrl(url.trim());
      }
      setSource("local");
      setLocalMode("external");
      setLoadedOnce(false);
      setReloadCounter((n) => n + 1);
    };
    window.addEventListener("soroban:setPreviewLocalUrl", handler);
    return () => window.removeEventListener("soroban:setPreviewLocalUrl", handler);
  }, []);

  // ─── External URL probe (only when localMode === "external") ──────────
  const prevOnlineRef = useRef(false);
  useEffect(() => {
    if (source !== "local" || localMode !== "external") return undefined;
    const normalized = normalizeUrl(localUrl);
    if (!normalized) return undefined;
    const stop = watchLocalServer(normalized, (res) => {
      setExternalStatus({ phase: res.ok ? "online" : "offline", reason: res.reason });
      if (res.ok && !prevOnlineRef.current) {
        prevOnlineRef.current = true;
        setLoadedOnce(false);
        setReloadCounter((n) => n + 1);
      } else if (!res.ok) {
        prevOnlineRef.current = false;
      }
    }, { intervalMs: 3000, timeoutMs: 1500 });
    return stop;
  }, [source, localMode, localUrl]);

  // Clean up the blob URL on unmount so it doesn't leak after the user
  // closes the panel.
  useEffect(() => () => {
    if (blobUrlRef.current) {
      try { URL.revokeObjectURL(blobUrlRef.current); } catch { /* ignore */ }
      blobUrlRef.current = null;
    }
    for (const url of auxBlobUrlsRef.current) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    auxBlobUrlsRef.current = [];
  }, []);

  // ─── Derived state ────────────────────────────────────────────────────
  const device = DEVICE_PRESETS.find((d) => d.id === deviceId) || DEVICE_PRESETS[0];

  const activeUrl = useMemo(() => {
    if (source === "deployed") return deployedUrl;
    if (localMode === "in-ide") return buildState.phase === "ready" ? buildState.blobUrl : "";
    return normalizeUrl(localUrl);
  }, [source, deployedUrl, localMode, buildState, localUrl]);

  const refresh = useCallback(() => {
    setLoadedOnce(false);
    if (source === "local" && localMode === "in-ide") {
      // Refresh = rebuild — code may have changed.
      runBuild();
      return;
    }
    setReloadCounter((n) => n + 1);
  }, [source, localMode, runBuild]);

  const openInNewTab = useCallback(() => {
    if (activeUrl) window.open(activeUrl, "_blank", "noopener,noreferrer");
  }, [activeUrl]);

  const handleDownload = useCallback(async () => {
    setDownloadState({ kind: "loading" });
    try {
      const { filename, fileCount } = await downloadFrontendZip(treeData, fileContents);
      setDownloadState({ kind: "ok", filename, fileCount });
      setTimeout(() => setDownloadState({ kind: "idle" }), 4000);
    } catch (err) {
      setDownloadState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [treeData, fileContents]);

  const handleDeployAndPreview = useCallback(() => {
    window.dispatchEvent(new CustomEvent("soroban:setSidebarPanel", {
      detail: { panel: "fullstack" },
    }));
    window.dispatchEvent(new CustomEvent("soroban:openVercelDeploy"));
  }, []);

  const showLocalEmpty = source === "local" && detection.kind === "empty";
  const showDeployedEmpty = source === "deployed" && !deployedUrl;
  const localHasFrontend = detection.kind !== "empty";
  const hasContract = Boolean(previewContract?.contractId);
  const hasWallet = Boolean(walletAddress);
  const readyToRun = localHasFrontend && hasContract;

  const goDeploy = useCallback(() => openPanel("deploy"), [openPanel]);

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="pv-panel">
      <div className="pv-header">
        <div className="pv-source-toggle" role="tablist">
          <button
            role="tab"
            aria-selected={source === "local"}
            className={`pv-source-btn ${source === "local" ? "is-active" : ""}`}
            onClick={() => setSource("local")}
            title="Preview the app inside the IDE"
          >
            <Laptop2 size={12} /> Local
          </button>
          <button
            role="tab"
            aria-selected={source === "deployed"}
            className={`pv-source-btn ${source === "deployed" ? "is-active" : ""}`}
            onClick={() => setSource("deployed")}
            title="Preview the latest Vercel deployment"
          >
            <Globe size={12} /> Deployed
          </button>
        </div>

        {/* Action bar — varies based on what we're previewing. */}
        {source === "local" && localMode === "in-ide" ? (
          <div className="pv-action-row">
            <button
              className={`pv-live-toggle ${autoLive ? "is-on" : ""}`}
              onClick={() => setAutoLive((v) => !v)}
              title={autoLive
                ? "Live rebuild on — edits to frontend/ auto-refresh the preview"
                : "Live rebuild off — click Rebuild after edits"}
            >
              <Zap size={12} />
              <span>Live</span>
            </button>
            <button
              className="pv-cta-btn pv-cta-primary pv-action-run"
              onClick={runBuild}
              disabled={buildState.phase === "building" || !localHasFrontend}
              title="Bundle the workspace and run it inside the IDE (⌘⇧B)"
            >
              {buildState.phase === "building"
                ? <><Loader size={12} className="pv-spin" /> Building...</>
                : buildState.phase === "ready"
                  ? <><RefreshCw size={12} /> Rebuild</>
                  : <><Play size={12} /> Run in IDE</>}
            </button>
            <button
              className="pv-icon-btn"
              onClick={() => setLocalMode("external")}
              title="Use an external dev server URL instead"
            >
              <Settings2 size={12} />
            </button>
            <button
              className="pv-icon-btn"
              onClick={openInNewTab}
              disabled={!activeUrl}
              title="Open in new tab"
            >
              <ExternalLink size={12} />
            </button>
          </div>
        ) : source === "local" ? (
          <div className="pv-url-row">
            <input
              className="pv-url-input"
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") refresh(); }}
              placeholder="http://localhost:5173"
              spellCheck={false}
            />
            <button
              className="pv-icon-btn"
              onClick={() => setLocalMode("in-ide")}
              title="Back to in-IDE preview"
            >
              <Laptop2 size={12} />
            </button>
            <button
              className="pv-icon-btn"
              onClick={refresh}
              disabled={!activeUrl}
              title="Reload preview"
            >
              <RefreshCw size={12} />
            </button>
            <button
              className="pv-icon-btn"
              onClick={openInNewTab}
              disabled={!activeUrl}
              title="Open in new tab"
            >
              <ExternalLink size={12} />
            </button>
          </div>
        ) : (
          <div className="pv-url-row">
            <div className="pv-url-static" title={deployedUrl || "No deployment yet"}>
              {deployedUrl
                ? deployedUrl.replace(/^https?:\/\//, "")
                : <span className="pv-url-static-empty">No deployment yet</span>}
            </div>
            <button
              className="pv-icon-btn"
              onClick={refresh}
              disabled={!activeUrl}
              title="Reload preview"
            >
              <RefreshCw size={12} />
            </button>
            <button
              className="pv-icon-btn"
              onClick={openInNewTab}
              disabled={!activeUrl}
              title="Open in new tab"
            >
              <ExternalLink size={12} />
            </button>
          </div>
        )}

        {source === "local" && localMode === "in-ide" && localHasFrontend && (
          <ReadinessStrip
            hasContract={hasContract}
            hasWallet={hasWallet}
            contractId={previewContract?.contractId}
            walletAddress={walletAddress}
            autoLive={autoLive}
            buildPhase={buildState.phase}
            onDeploy={goDeploy}
            onConnectWallet={connectWallet}
          />
        )}

        <div className="pv-device-row">
          {DEVICE_PRESETS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`pv-device-btn ${deviceId === id ? "is-active" : ""}`}
              onClick={() => setDeviceId(id)}
              title={label}
            >
              <Icon size={12} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="pv-body">
        {showLocalEmpty ? (
          <EmptyState
            icon={<AlertCircle size={20} />}
            title="No workspace loaded"
            subtitle="Open a project that contains a frontend folder to use the preview."
          />
        ) : showDeployedEmpty ? (
          <EmptyState
            icon={<Globe size={20} />}
            title="No deployment yet"
            subtitle="Deploy your frontend to Vercel and the latest URL will appear here automatically."
            primaryAction={localHasFrontend ? {
              label: "Deploy with Vercel",
              icon: <Rocket size={12} />,
              onClick: handleDeployAndPreview,
            } : null}
          />
        ) : source === "local" && localMode === "in-ide" ? (
          <InIdeBody
            buildState={buildState}
            device={device}
            deviceId={deviceId}
            reloadCounter={reloadCounter}
            iframeRef={iframeRef}
            onLoad={handleIframeLoad}
            onRun={runBuild}
            readyToRun={readyToRun}
            hasContract={hasContract}
            hasWallet={hasWallet}
            onDeploy={goDeploy}
            onConnectWallet={connectWallet}
          />
        ) : source === "local" ? (
          <ExternalBody
            url={activeUrl}
            phase={externalStatus.phase}
            device={device}
            deviceId={deviceId}
            reloadCounter={reloadCounter}
            iframeRef={iframeRef}
            onLoad={handleIframeLoad}
            folderPath={detection.kind === "subfolder" ? detection.path : null}
            refresh={refresh}
          />
        ) : activeUrl ? (
          <div className="pv-frame-wrap" data-device={deviceId}>
            <iframe
              ref={iframeRef}
              key={`${source}-${reloadCounter}`}
              className="pv-frame"
              src={activeUrl}
              style={device.width ? { width: device.width, maxWidth: "100%" } : undefined}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
              title={`${source} preview`}
              onLoad={handleIframeLoad}
            />
          </div>
        ) : null}

        {source === "local" && buildState.phase !== "ready" && (
          <LocalHints
            detection={detection}
            downloadState={downloadState}
            onDownload={handleDownload}
            onDeployAndPreview={handleDeployAndPreview}
          />
        )}
        {source === "local" && buildState.phase === "ready" && (
          <div className="pv-hints-collapsed">
            <button
              type="button"
              className="pv-hints-toggle"
              onClick={() => setHintsOpen((v) => !v)}
              aria-expanded={hintsOpen}
            >
              {hintsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {hintsOpen ? "Hide tips" : "Deploy or download"}
            </button>
            {hintsOpen && (
              <LocalHints
                detection={detection}
                downloadState={downloadState}
                onDownload={handleDownload}
                onDeployAndPreview={handleDeployAndPreview}
              />
            )}
          </div>
        )}
      </div>

      {source === "deployed" && deployedUrl && (
        <div className="pv-footer">
          <span className="pv-footer-status">
            <CheckCircle size={11} /> Loaded {loadedOnce ? "" : "(may take a moment)"}
          </span>
          <button
            className="pv-link-btn"
            onClick={() => {
              try {
                const v = localStorage.getItem(LAST_VERCEL_URL_KEY) || "";
                setDeployedUrl(v);
              } catch { /* ignore */ }
              refresh();
            }}
            title="Re-sync from latest stored deployment"
          >
            Use latest deployment
          </button>
        </div>
      )}
    </div>
  );
};

/* ── Subcomponents ──────────────────────────────────────────────────────── */

const EmptyState = ({ icon, title, subtitle, primaryAction }) => (
  <div className="pv-empty">
    <div className="pv-empty-icon">{icon}</div>
    <div className="pv-empty-title">{title}</div>
    <div className="pv-empty-sub">{subtitle}</div>
    {primaryAction && (
      <button className="pv-cta-btn pv-cta-primary" onClick={primaryAction.onClick}>
        {primaryAction.icon} {primaryAction.label}
      </button>
    )}
  </div>
);

const ReadinessStrip = ({
  hasContract,
  hasWallet,
  contractId,
  walletAddress,
  autoLive,
  buildPhase,
  onDeploy,
  onConnectWallet,
}) => (
  <div className="pv-readiness">
    <ReadinessChip
      ok={hasContract}
      icon={<FileCode size={11} />}
      label={hasContract ? `Contract ${shortContractId(contractId)}` : "No contract"}
      actionLabel={hasContract ? null : "Deploy"}
      onAction={hasContract ? null : onDeploy}
    />
    <ReadinessChip
      ok={hasWallet}
      icon={<Wallet size={11} />}
      label={hasWallet ? `Wallet ${shortContractId(walletAddress)}` : "No wallet"}
      actionLabel={hasWallet ? null : "Connect"}
      onAction={hasWallet ? null : onConnectWallet}
    />
    {buildPhase === "ready" && autoLive && (
      <span className="pv-readiness-live">
        <Zap size={10} /> Live rebuild on
      </span>
    )}
  </div>
);

const ReadinessChip = ({ ok, icon, label, actionLabel, onAction }) => (
  <div className={`pv-chip ${ok ? "is-ok" : "is-warn"}`}>
    <span className="pv-chip-icon">{icon}</span>
    <span className="pv-chip-label">{label}</span>
    {!ok && actionLabel && onAction && (
      <button type="button" className="pv-chip-action" onClick={onAction}>
        {actionLabel}
      </button>
    )}
  </div>
);

/**
 * The default Local body: build the workspace in the browser and frame it.
 */
const InIdeBody = ({
  buildState,
  device,
  deviceId,
  reloadCounter,
  iframeRef,
  onLoad,
  onRun,
  readyToRun,
  hasContract,
  hasWallet,
  onDeploy,
  onConnectWallet,
}) => {
  if (buildState.phase === "idle") {
    return (
      <div className="pv-build-idle">
        <div className="pv-build-icon"><Play size={22} /></div>
        <div className="pv-build-title">
          {readyToRun ? "Ready to preview" : "Set up, then run"}
        </div>
        <div className="pv-build-sub">
          {readyToRun
            ? <>Your frontend and contract are linked. One click compiles and frames your app here.</>
            : <>Deploy your contract in the <strong>Deploy</strong> panel first — the contract ID is picked up automatically.</>}
        </div>

        <div className="pv-launch-steps">
          <LaunchStep
            done
            title="Frontend detected"
            sub="TypeScript / JSX compile in-browser"
          />
          <LaunchStep
            done={hasContract}
            title="Contract deployed"
            sub={hasContract ? "ID wired into the preview build" : "Build & deploy in the Deploy panel"}
            action={hasContract ? null : { label: "Open Deploy", onClick: onDeploy }}
          />
          <LaunchStep
            done={hasWallet}
            title="Wallet connected"
            sub={hasWallet ? "Freighter linked for read/write calls" : "Optional — connect to test transactions"}
            action={hasWallet ? null : { label: "Connect", onClick: onConnectWallet }}
          />
        </div>

        <button
          className={`pv-cta-btn pv-cta-primary pv-build-cta ${readyToRun ? "pv-build-cta-ready" : ""}`}
          onClick={onRun}
        >
          <Play size={12} /> {readyToRun ? "Run in IDE" : "Try preview anyway"}
        </button>
        <div className="pv-build-fine">
          Turn on <strong>Live</strong> above — edits to <code>frontend/</code> auto-rebuild in ~1s.
          Shortcut: <kbd>⌘⇧B</kbd>
        </div>
      </div>
    );
  }

  if (buildState.phase === "building") {
    const progress = BUILD_STAGE_PROGRESS[buildState.stage] ?? 8;
    return (
      <div className="pv-build-progress">
        <Loader size={22} className="pv-spin" />
        <div className="pv-build-title">{buildState.message || "Building..."}</div>
        <div className="pv-build-progress-bar" aria-hidden="true">
          <div className="pv-build-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <BuildStages stage={buildState.stage} />
      </div>
    );
  }

  if (buildState.phase === "error") {
    return (
      <div className="pv-build-error">
        <AlertCircle size={20} />
        <div className="pv-build-error-title">Build failed</div>
        <pre className="pv-build-error-msg">{buildState.message}</pre>
        {Array.isArray(buildState.details) && buildState.details.length > 0 && (
          <ul className="pv-build-error-list">
            {buildState.details.slice(0, 8).map((d, i) => (
              <li key={i}>
                {d.location?.file ? <code>{d.location.file}</code> : null}
                {d.location?.line ? `:${d.location.line}` : ""} — {d.text}
              </li>
            ))}
          </ul>
        )}
        <button className="pv-cta-btn pv-cta-primary" onClick={onRun}>
          <RefreshCw size={12} /> Try again
        </button>
      </div>
    );
  }

  // Ready — frame the blob URL.
  return (
    <>
      <div className="pv-build-status">
        <CheckCircle size={12} />
        <span>
          Live preview · {Math.round(buildState.durationMs)} ms ·{" "}
          {(buildState.bytes / 1024).toFixed(0)} KB
        </span>
      </div>
      <div className="pv-frame-wrap" data-device={deviceId}>
        <iframe
          ref={iframeRef}
          key={`in-ide-${reloadCounter}`}
          className="pv-frame"
          src={buildState.blobUrl}
          style={device.width ? { width: device.width, maxWidth: "100%" } : undefined}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
          title="In-IDE preview"
          onLoad={onLoad}
        />
      </div>
    </>
  );
};

const LaunchStep = ({ done, title, sub, action }) => (
  <div className={`pv-launch-step ${done ? "is-done" : ""}`}>
    <span className="pv-launch-step-check">
      {done ? <CheckCircle size={13} /> : <span className="pv-launch-step-dot" />}
    </span>
    <div className="pv-launch-step-body">
      <div className="pv-launch-step-title">{title}</div>
      <div className="pv-launch-step-sub">{sub}</div>
    </div>
    {action && (
      <button type="button" className="pv-chip-action" onClick={action.onClick}>
        {action.label}
      </button>
    )}
  </div>
);

const BuildStages = ({ stage }) => {
  const currentIdx = BUILD_STAGE_ORDER.indexOf(stage);
  return (
    <div className="pv-build-stages">
      {BUILD_STAGE_ORDER.map((s, i) => (
        <div
          key={s}
          className={`pv-build-stage ${i < currentIdx ? "is-done" : i === currentIdx ? "is-current" : ""}`}
        >
          <span className="pv-build-stage-dot" />
          <span>{BUILD_STAGE_LABELS[s]}</span>
        </div>
      ))}
    </div>
  );
};

/**
 * External-URL Local body — the legacy "frame http://localhost:5173" path,
 * kept as an advanced fallback.
 */
const ExternalBody = ({ url, phase, device, deviceId, reloadCounter, iframeRef, onLoad, folderPath, refresh }) => (
  <>
    <div className="pv-local-status-bar" data-phase={phase}>
      <span className="pv-status-dot" />
      <span className="pv-status-label">
        {phase === "online" && <>Dev server online at <code>{url}</code></>}
        {phase === "offline" && <>Waiting for dev server at <code>{url}</code>...</>}
        {phase === "checking" && <>Checking <code>{url}</code>...</>}
      </span>
      <button className="pv-link-btn" onClick={refresh} title="Reload preview">
        <RefreshCw size={11} /> Reload
      </button>
    </div>
    <div className="pv-frame-wrap" data-device={deviceId}>
      {phase === "online" ? (
        <iframe
          ref={iframeRef}
          key={`external-${reloadCounter}`}
          className="pv-frame"
          src={url}
          style={device.width ? { width: device.width, maxWidth: "100%" } : undefined}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
          title="External preview"
          onLoad={onLoad}
        />
      ) : (
        <LocalWaiting url={url} phase={phase} folderPath={folderPath} />
      )}
    </div>
  </>
);

const LocalWaiting = ({ url, phase, folderPath }) => (
  <div className="pv-local-waiting">
    <div className="pv-local-waiting-icon">
      {phase === "checking" ? <Loader size={22} className="pv-spin" /> : <Laptop2 size={22} />}
    </div>
    <div className="pv-local-waiting-title">
      {phase === "checking" ? "Looking for your dev server..." : "No dev server running yet"}
    </div>
    <div className="pv-local-waiting-sub">
      Run this in a terminal on your machine:
    </div>
    <code className="pv-local-waiting-cmd">
      {folderPath ? `cd ${folderPath} && ` : ""}npm install &amp;&amp; npm run dev
    </code>
    <div className="pv-local-waiting-foot">
      Or click the <Laptop2 size={11} /> icon above to switch back to the
      zero-terminal in-IDE preview.
    </div>
  </div>
);

const LocalHints = ({ detection, downloadState, onDownload, onDeployAndPreview }) => {
  const folderPath = detection.kind === "subfolder" ? detection.path : null;
  const folderLabel = folderPath ? `${folderPath}/` : "your frontend folder";

  return (
    <div className="pv-hints">
      <div className="pv-hint-title">
        <Sparkles size={11} /> What's next?
      </div>

      <div className="pv-hint-row">
        <div className="pv-hint-num">1</div>
        <div className="pv-hint-text">
          <strong>Ship publicly</strong> — when the preview looks good,
          deploy it to Vercel for a sharable URL.
        </div>
        <button className="pv-cta-btn pv-cta-primary" onClick={onDeployAndPreview}>
          <Rocket size={11} /> Deploy and preview
        </button>
      </div>

      <div className="pv-hint-row">
        <div className="pv-hint-num">2</div>
        <div className="pv-hint-text">
          <strong>Run on your laptop</strong> — download{" "}
          <code>{folderLabel}</code> and run{" "}
          <code>npm install &amp;&amp; npm run dev</code> for HMR with your
          favourite editor.
        </div>
        <button
          className="pv-cta-btn"
          onClick={onDownload}
          disabled={downloadState.kind === "loading"}
        >
          {downloadState.kind === "loading"
            ? <><Loader size={11} className="pv-spin" /> Zipping...</>
            : <><Download size={11} /> Download .zip</>}
        </button>
      </div>

      {downloadState.kind === "ok" && (
        <div className="pv-hint-success">
          <CheckCircle size={11} /> Downloaded <code>{downloadState.filename}</code> ({downloadState.fileCount} files).
        </div>
      )}
      {downloadState.kind === "error" && (
        <div className="pv-hint-error">
          <AlertCircle size={11} /> {downloadState.message}
        </div>
      )}
    </div>
  );
};

export default PreviewPanel;
