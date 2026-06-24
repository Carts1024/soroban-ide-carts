import React, { useEffect, useMemo, useState } from "react";
import { X, Folder, Loader, Rocket, Plus, AlertTriangle, CheckCircle, ExternalLink } from "lucide-react";
import { useFullstack } from "../../context/FullstackContext";
import { detectFrontendRoot, listDeployableSubfolders } from "./fullstackBundler";

const MAX_ENV_ROWS = 30;
const LAST_VERCEL_URL_KEY = "soroban.lastVercelUrl";

const NewDeploymentModal = ({ treeData, fileContents, initialEnvRows, onClose, onDeployed }) => {
  const {
    projects, selectedProjectId,
    deployFlow, deployWorkspace, clearDeployFlow,
  } = useFullstack();

  const detection = useMemo(() => detectFrontendRoot(treeData), [treeData]);
  const subfolders = useMemo(() => listDeployableSubfolders(treeData), [treeData]);

  // Pre-select the auto-detected folder so users can deploy in one click.
  const initialFolderId = detection.kind === "subfolder"
    ? detection.folder.id
    : detection.kind === "workspace"
      ? "__root__"
      : "";

  const [folderId, setFolderId] = useState(initialFolderId);
  const [projectChoice, setProjectChoice] = useState(selectedProjectId || "");
  const [target, setTarget] = useState("preview"); // "preview" | "production"
  const [envRows, setEnvRows] = useState(() => {
    if (Array.isArray(initialEnvRows) && initialEnvRows.length > 0) {
      // Caller controls the initial set (e.g. auto-inject after contract
      // deploy). Append a blank row so the user can keep adding more.
      return [...initialEnvRows, { key: "", value: "" }];
    }
    return [{ key: "", value: "" }];
  });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => () => clearDeployFlow(), [clearDeployFlow]);

  // Once a deploy reaches a healthy terminal state, persist the URL so the
  // Preview panel can frame it without any further wiring.
  useEffect(() => {
    if (deployFlow?.stage === "done" && deployFlow?.deploymentUrl) {
      try {
        localStorage.setItem(LAST_VERCEL_URL_KEY, deployFlow.deploymentUrl);
        // Same-tab notifier — `storage` events only fire across tabs.
        window.dispatchEvent(new CustomEvent("soroban:vercelDeployUrl", {
          detail: { url: deployFlow.deploymentUrl },
        }));
      } catch { /* ignore quota / private-mode errors */ }
    }
  }, [deployFlow?.stage, deployFlow?.deploymentUrl]);

  const project = projects.find((p) => p.id === projectChoice);
  const isWorkspaceDeploy = folderId === "__root__";
  const showWorkspaceWarning = isWorkspaceDeploy && detection.kind === "workspace" && !detection.path;

  const handleAddEnv = () => {
    if (envRows.length >= MAX_ENV_ROWS) return;
    setEnvRows((r) => [...r, { key: "", value: "" }]);
  };

  const handleEnvChange = (i, field, value) => {
    setEnvRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };

  const handleRemoveEnv = (i) => {
    setEnvRows((rows) => rows.filter((_, idx) => idx !== i));
  };

  const handleDeploy = async () => {
    setRunning(true);
    setError(null);
    try {
      const env = {};
      envRows.forEach((r) => {
        const k = r.key.trim();
        if (k) env[k] = r.value;
      });
      const result = await deployWorkspace({
        treeData,
        fileContents,
        projectOverride: project ? { id: project.id, name: project.name } : null,
        targetFolderId: folderId === "__root__" ? null : folderId,
        env,
        target: target === "production" ? "production" : null,
      });
      onDeployed?.(result);
    } catch (err) {
      setError(err.message || "Deployment failed");
    } finally {
      setRunning(false);
    }
  };

  const stage = deployFlow?.stage;
  const progressPct = deployFlow?.total
    ? Math.round(((deployFlow.uploaded || 0) / deployFlow.total) * 100)
    : 0;

  return (
    <div className="fs-modal-backdrop" onClick={onClose}>
      <div className="fs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fs-modal-header">
          <div className="fs-modal-title">
            <Rocket size={14} /> New Deployment
          </div>
          <button className="fs-icon-btn" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="fs-modal-body">
          <div className="fs-field">
            <label className="fs-label">Source folder</label>
            <select
              className="fs-input"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              disabled={running}
            >
              <option value="__root__">Entire workspace</option>
              {subfolders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}/</option>
              ))}
            </select>
            <div className="fs-hint">
              {detection.kind === "subfolder" ? (
                <>Detected <code>{detection.path}/</code> as your frontend.</>
              ) : (
                <>No conventional frontend folder detected.</>
              )}
            </div>
            {showWorkspaceWarning && (
              <div className="fs-warn">
                <AlertTriangle size={11} />
                Deploying the entire workspace. Vercel may fail to build a Rust contract crate — consider creating a <code>frontend/</code> folder.
              </div>
            )}
          </div>

          <div className="fs-field">
            <label className="fs-label">Vercel project</label>
            <select
              className="fs-input"
              value={projectChoice}
              onChange={(e) => setProjectChoice(e.target.value)}
              disabled={running}
            >
              <option value="">Create new from source folder name</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="fs-field">
            <label className="fs-label">Target</label>
            <div className="fs-radio-row">
              <label className={`fs-radio ${target === "preview" ? "is-active" : ""}`}>
                <input
                  type="radio"
                  name="target"
                  value="preview"
                  checked={target === "preview"}
                  onChange={() => setTarget("preview")}
                  disabled={running}
                />
                Preview
              </label>
              <label className={`fs-radio ${target === "production" ? "is-active" : ""}`}>
                <input
                  type="radio"
                  name="target"
                  value="production"
                  checked={target === "production"}
                  onChange={() => setTarget("production")}
                  disabled={running}
                />
                Production
              </label>
            </div>
          </div>

          <div className="fs-field">
            <label className="fs-label">Environment variables</label>
            <div className="fs-env-grid">
              {envRows.map((row, i) => (
                <div className="fs-env-row" key={i}>
                  <input
                    className="fs-input"
                    placeholder="KEY"
                    value={row.key}
                    onChange={(e) => handleEnvChange(i, "key", e.target.value)}
                    disabled={running}
                  />
                  <input
                    className="fs-input"
                    placeholder="value"
                    value={row.value}
                    onChange={(e) => handleEnvChange(i, "value", e.target.value)}
                    disabled={running}
                  />
                  <button
                    className="fs-icon-btn"
                    onClick={() => handleRemoveEnv(i)}
                    disabled={running}
                    title="Remove"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              <button
                className="fs-btn fs-btn-ghost fs-btn-small"
                onClick={handleAddEnv}
                disabled={running || envRows.length >= MAX_ENV_ROWS}
                type="button"
              >
                <Plus size={11} /> Add variable
              </button>
            </div>
          </div>

          {stage && (
            <div className="fs-progress-block">
              {stage === "bundling" && (
                <div className="fs-progress-row"><Loader size={12} className="spin" /> {deployFlow.message || "Collecting files..."}</div>
              )}
              {stage === "uploading" && (
                <>
                  <div className="fs-progress-row">
                    Uploading <strong>{deployFlow.uploaded}</strong> / {deployFlow.total} files
                  </div>
                  <div className="fs-progress-bar">
                    <div className="fs-progress-fill" style={{ width: `${progressPct}%` }} />
                  </div>
                </>
              )}
              {stage === "creating" && (
                <div className="fs-progress-row"><Loader size={12} className="spin" /> Creating deployment...</div>
              )}
              {stage === "polling" && (
                <div className="fs-progress-row">
                  <Loader size={12} className="spin" /> Building... {deployFlow.readyState ? `(${deployFlow.readyState})` : ""}
                  {deployFlow.deploymentUrl && (
                    <a
                      className="fs-link"
                      href={deployFlow.deploymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {deployFlow.deploymentUrl.replace(/^https?:\/\//, "")} <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}
              {stage === "done" && (
                <div className="fs-progress-row fs-progress-done">
                  <CheckCircle size={12} /> Ready
                  {deployFlow.deploymentUrl && (
                    <a
                      className="fs-link"
                      href={deployFlow.deploymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {deployFlow.deploymentUrl.replace(/^https?:\/\//, "")} <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}
              {stage === "error" && (
                <div className="fs-progress-row fs-progress-error">
                  <AlertTriangle size={12} /> {deployFlow.message || "Deployment failed"}
                </div>
              )}
            </div>
          )}

          {error && !stage && <div className="fs-error">{error}</div>}
        </div>

        <div className="fs-modal-footer">
          <button className="fs-btn fs-btn-ghost" onClick={onClose} disabled={running}>
            {stage === "done" ? "Close" : "Cancel"}
          </button>
          <button
            className="fs-btn fs-btn-primary"
            onClick={handleDeploy}
            disabled={running || !folderId}
          >
            {running ? <Loader size={12} className="spin" /> : <Rocket size={12} />}
            {running ? "Deploying..." : "Deploy"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NewDeploymentModal;
