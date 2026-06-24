import React from "react";
import { Loader, RefreshCw, Rocket, ExternalLink, ChevronLeft } from "lucide-react";
import { useFullstack } from "../../context/FullstackContext";

const STATE_META = {
  READY:       { label: "Ready",       cls: "fs-state-ready" },
  BUILDING:    { label: "Building",    cls: "fs-state-building" },
  INITIALIZING:{ label: "Queued",      cls: "fs-state-building" },
  QUEUED:      { label: "Queued",      cls: "fs-state-building" },
  ERROR:       { label: "Error",       cls: "fs-state-error" },
  CANCELED:    { label: "Canceled",    cls: "fs-state-canceled" },
};

/** Hash-color a string to a pastel-ish hue. Used so each deployment card
 *  gets a stable monogram color. */
const colorFor = (id) => {
  let h = 0;
  for (let i = 0; i < (id || "").length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
};

const formatRelative = (ts) => {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
};

const DeploymentList = ({ onBack, onOpenDetail, onNewDeployment }) => {
  const {
    projects, selectedProjectId,
    deployments, loading, refreshDeployments,
  } = useFullstack();

  const project = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="fs-deployments">
      <div className="fs-deployments-header">
        <button className="fs-link" onClick={onBack}>
          <ChevronLeft size={12} /> Projects
        </button>
        <div className="fs-project-title">
          {project?.name || "Deployments"}
        </div>
        <div className="fs-deployments-actions">
          <button
            className="fs-icon-btn"
            onClick={refreshDeployments}
            disabled={loading?.deployments}
            title="Refresh"
          >
            {loading?.deployments ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
      </div>

      <button className="fs-btn fs-btn-primary fs-btn-block" onClick={onNewDeployment}>
        <Rocket size={13} /> New Deployment
      </button>

      {loading?.deployments && deployments.length === 0 ? (
        <div className="fs-empty"><Loader size={12} className="spin" /> Loading deployments…</div>
      ) : deployments.length === 0 ? (
        <div className="fs-empty-block">
          <Rocket size={18} />
          <div className="fs-empty-title">No deployments yet</div>
          <div className="fs-empty-sub">Click <strong>New Deployment</strong> above to ship your workspace to Vercel.</div>
        </div>
      ) : (
        <div className="fs-deployment-list">
          {deployments.map((d) => {
            const state = STATE_META[(d.readyState || d.state || "").toUpperCase()] || { label: d.readyState || "Unknown", cls: "fs-state-unknown" };
            const hue = colorFor(d.uid || d.id);
            const url = d.url || d.alias?.[0];
            const isProd = d.target === "production";
            return (
              <button
                key={d.uid || d.id}
                className="fs-deployment-card"
                onClick={() => onOpenDetail?.(d.uid || d.id)}
              >
                <span
                  className="fs-deployment-monogram"
                  style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 32%), hsl(${(hue + 50) % 360} 60% 22%))` }}
                >
                  {(project?.name || d.name || "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="fs-deployment-body">
                  <div className="fs-deployment-row1">
                    <span className={`fs-state-pill ${state.cls}`}>{state.label}</span>
                    {isProd && <span className="fs-prod-badge">Production</span>}
                    <span className="fs-deployment-url" title={url || d.uid || d.id}>
                      {url ? url.replace(/^https?:\/\//, "") : (d.uid || d.id)}
                    </span>
                    {url && (
                      <a
                        className="fs-icon-btn fs-deployment-open"
                        href={url.startsWith("http") ? url : `https://${url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Open deployment"
                      >
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                  <div className="fs-deployment-row2">
                    <span className="fs-deployment-meta">
                      {formatRelative(d.created || d.createdAt)}
                    </span>
                    {d.creator?.username && (
                      <span className="fs-deployment-meta">· {d.creator.username}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DeploymentList;
