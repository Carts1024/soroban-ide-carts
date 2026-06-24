import React, { useCallback, useMemo, useState } from "react";
import {
  Laptop2,
  Play,
  Sparkles,
  Check,
  Download,
  Loader,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Terminal,
  Wallet,
  FileCode,
  Zap,
  Rocket,
} from "lucide-react";
import { detectFrontendRoot } from "./fullstackBundler";
import { downloadFrontendZip } from "../preview/downloadFrontend";
import { shortContractId } from "../preview/previewUtils";

/**
 * Local-development view for the Fullstack panel — one-click in-IDE preview
 * with a live readiness checklist and deploy-to-preview flow.
 */
const LocalDeployView = ({
  treeData,
  fileContents,
  pendingContract,
  onApplyEnv,
  onClearContract,
  contractId,
  walletAddress,
  onConnectWallet,
}) => {
  const detection = useMemo(() => detectFrontendRoot(treeData), [treeData]);

  const [savedEnv, setSavedEnv] = useState(false);
  const [downloadState, setDownloadState] = useState({ kind: "idle" });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const folderPath = detection.kind === "subfolder" ? detection.path : null;
  const folderLabel = folderPath ? `${folderPath}/` : "frontend/";

  const activeContractId = pendingContract?.contractId || contractId;
  const hasContract = Boolean(activeContractId?.startsWith("C"));
  const hasWallet = Boolean(walletAddress);
  const readyToRun = detection.kind !== "empty" && hasContract;

  const openPanel = useCallback((panel) => {
    window.dispatchEvent(new CustomEvent("soroban:setSidebarPanel", { detail: { panel } }));
  }, []);

  const handleRunInIde = useCallback(() => {
    window.dispatchEvent(new CustomEvent("soroban:runInIde"));
  }, []);

  const handleApplyEnv = useCallback(() => {
    if (!pendingContract || typeof onApplyEnv !== "function") return;
    const ok = onApplyEnv({
      VITE_CONTRACT_ID: pendingContract.contractId,
      VITE_NETWORK: pendingContract.network || "TESTNET",
    });
    if (ok) {
      setSavedEnv(true);
      setTimeout(() => setSavedEnv(false), 4000);
      if (typeof onClearContract === "function") onClearContract();
      handleRunInIde();
    }
  }, [pendingContract, onApplyEnv, onClearContract, handleRunInIde]);

  const handleDownload = useCallback(async () => {
    setDownloadState({ kind: "loading" });
    try {
      const { filename, fileCount } = await downloadFrontendZip(
        treeData,
        fileContents || {},
      );
      setDownloadState({ kind: "ok", filename, fileCount });
      setTimeout(() => setDownloadState({ kind: "idle" }), 4000);
    } catch (err) {
      setDownloadState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [treeData, fileContents]);

  const command = folderPath
    ? `cd ${folderPath} && npm install && npm run dev`
    : `npm install && npm run dev`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = command;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); } catch { /* ignore */ }
      document.body.removeChild(ta);
      setTimeout(() => setCopied(false), 1800);
    }
  }, [command]);

  if (detection.kind === "empty") {
    return (
      <div className="ld-view">
        <div className="ld-empty">
          <div className="ld-empty-icon"><Laptop2 size={22} /></div>
          <div className="ld-empty-title">No frontend folder found</div>
          <div className="ld-empty-sub">
            Open a project that contains a <code>frontend/</code>,{" "}
            <code>web/</code>, or <code>app/</code> directory to run it
            inside the IDE.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ld-view">
      <div className="ld-hero">
        <div className="ld-hero-icon"><Laptop2 size={20} /></div>
        <div className="ld-hero-text">
          <div className="ld-hero-title">Build & preview in one click</div>
          <div className="ld-hero-sub">
            Compiles <code>{folderLabel}</code> in your browser — no terminal.
            Turn on <strong>Live</strong> in Preview to auto-refresh as you edit.
          </div>
        </div>
        {readyToRun && (
          <span className="ld-status ld-status-online">
            <span className="ld-status-dot" /> Ready
          </span>
        )}
      </div>

      <div className="ld-readiness">
        <ReadinessChip
          ok
          icon={<FileCode size={11} />}
          label={`${folderLabel} detected`}
        />
        <ReadinessChip
          ok={hasContract}
          icon={<Rocket size={11} />}
          label={hasContract ? `Contract ${shortContractId(activeContractId)}` : "Deploy contract"}
          action={hasContract ? null : { label: "Deploy", onClick: () => openPanel("deploy") }}
        />
        <ReadinessChip
          ok={hasWallet}
          icon={<Wallet size={11} />}
          label={hasWallet ? `Wallet ${shortContractId(walletAddress)}` : "Connect wallet"}
          action={hasWallet ? null : { label: "Connect", onClick: onConnectWallet }}
        />
      </div>

      {pendingContract && (
        <div className="ld-banner">
          <div className="ld-banner-icon"><Sparkles size={12} /></div>
          <div className="ld-banner-body">
            <div className="ld-banner-title">
              New deploy <code>{shortContractId(pendingContract.contractId)}</code>
            </div>
            <div className="ld-banner-sub">
              Save to <code>{folderLabel}.env</code> and launch the preview.
            </div>
          </div>
          <button className="ld-btn ld-btn-primary ld-btn-small" onClick={handleApplyEnv}>
            <Play size={11} /> Save & run
          </button>
        </div>
      )}

      {savedEnv && (
        <div className="ld-inline-toast">
          <Check size={11} /> Opening preview with your new contract ID…
        </div>
      )}

      <div className="ld-primary-card">
        <div className="ld-primary-body">
          <div className="ld-primary-title">
            <Play size={13} /> Run in IDE
          </div>
          <div className="ld-primary-sub">
            {readyToRun
              ? <>Bundles <code>{folderLabel}</code> and opens it in the Preview panel instantly.</>
              : <>Deploy your contract first — then this button launches the live preview.</>}
          </div>
        </div>
        <button
          className={`ld-btn ld-btn-primary ld-btn-lg ${readyToRun ? "ld-btn-pulse" : ""}`}
          onClick={handleRunInIde}
        >
          <Play size={13} /> {readyToRun ? "Run in IDE" : "Open Preview"}
        </button>
      </div>

      <div className="ld-bullets">
        <div className="ld-bullet">
          <Zap size={11} /> <strong>Live rebuild</strong> — edit frontend files, preview updates in ~1s.
        </div>
        <div className="ld-bullet">
          <Check size={11} /> Contract ID and wallet injected automatically at build time.
        </div>
        <div className="ld-bullet">
          <Check size={11} /> Shortcut in Preview: <kbd>⌘⇧B</kbd> to rebuild.
        </div>
      </div>

      <button
        className="ld-advanced-toggle"
        onClick={() => setAdvancedOpen((v) => !v)}
        aria-expanded={advancedOpen}
      >
        {advancedOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        Advanced — run on your own machine
      </button>

      {advancedOpen && (
        <div className="ld-advanced">
          <div className="ld-step-sub">
            Prefer Vite's full HMR? Run the dev server yourself and point Preview at its URL.
          </div>
          <div className="ld-cmd-row">
            <code className="ld-cmd">{command}</code>
            <button
              className={`ld-btn ld-btn-secondary ld-btn-small ${copied ? "is-success" : ""}`}
              onClick={handleCopy}
              title="Copy command"
            >
              {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
          </div>
          <div className="ld-step-sub">
            <Terminal size={10} /> Run in your own terminal — the IDE sandbox can't reach localhost.
          </div>
          <div className="ld-cta-row">
            <button
              className="ld-btn ld-btn-secondary"
              onClick={handleDownload}
              disabled={downloadState.kind === "loading"}
            >
              {downloadState.kind === "loading"
                ? <><Loader size={11} className="ld-spin" /> Zipping...</>
                : <><Download size={11} /> Download <code>{folderLabel}</code></>}
            </button>
          </div>
          {downloadState.kind === "ok" && (
            <div className="ld-inline-toast">
              <Check size={11} /> Downloaded <code>{downloadState.filename}</code>{" "}
              ({downloadState.fileCount} files).
            </div>
          )}
          {downloadState.kind === "error" && (
            <div className="ld-footer-error">
              <AlertCircle size={11} /> {downloadState.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ReadinessChip = ({ ok, icon, label, action }) => (
  <div className={`ld-chip ${ok ? "is-ok" : "is-warn"}`}>
    <span className="ld-chip-icon">{icon}</span>
    <span className="ld-chip-label">{label}</span>
    {action && (
      <button type="button" className="ld-chip-action" onClick={action.onClick}>
        {action.label}
      </button>
    )}
  </div>
);

export default LocalDeployView;
