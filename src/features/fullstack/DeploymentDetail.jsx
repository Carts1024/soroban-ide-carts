import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, Copy, Check, ExternalLink, Loader, RefreshCw, Eye, FileText } from "lucide-react";
import { useFullstack } from "../../context/FullstackContext";
import * as vercel from "../../services/vercelService";

const STATE_META = {
  READY:       { label: "Ready",       cls: "fs-state-ready" },
  BUILDING:    { label: "Building",    cls: "fs-state-building" },
  INITIALIZING:{ label: "Queued",      cls: "fs-state-building" },
  QUEUED:      { label: "Queued",      cls: "fs-state-building" },
  ERROR:       { label: "Error",       cls: "fs-state-error" },
  CANCELED:    { label: "Canceled",    cls: "fs-state-canceled" },
};

const eventToLine = (ev) => {
  if (!ev) return "";
  const payload = ev.payload || ev;
  const text = payload?.text ?? payload?.message ?? payload?.info ?? "";
  if (typeof text === "string") return text;
  try { return JSON.stringify(text); } catch { return String(text); }
};

const DeploymentDetail = ({ deploymentId, onBack }) => {
  const { token, selectedTeamId } = useFullstack();
  const [tab, setTab] = useState("preview"); // "preview" | "logs"
  const [dep, setDep] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef(null);

  const fetchDep = async () => {
    if (!token || !deploymentId) return;
    try {
      const d = await vercel.getDeployment(token, selectedTeamId || null, deploymentId);
      setDep(d);
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchEvents = async () => {
    if (!token || !deploymentId) return;
    try {
      const e = await vercel.getDeploymentEvents(token, selectedTeamId || null, deploymentId);
      setEvents(Array.isArray(e) ? e : []);
    } catch (err) {
      // logs endpoint can rate-limit; keep silent on the detail view
      console.debug("vercel events:", err.message);
    }
  };

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchDep(), fetchEvents()])
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentId, token, selectedTeamId]);

  // While the deployment is still building, poll every 3s.
  useEffect(() => {
    const state = (dep?.readyState || dep?.status || "").toUpperCase();
    const live = state && state !== "READY" && state !== "ERROR" && state !== "CANCELED";
    if (!live) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => { fetchDep(); fetchEvents(); }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep?.readyState, dep?.status]);

  const url = dep?.url ? (dep.url.startsWith("http") ? dep.url : `https://${dep.url}`) : null;
  const state = STATE_META[(dep?.readyState || dep?.status || "").toUpperCase()] || { label: dep?.readyState || "Unknown", cls: "fs-state-unknown" };
  const dashboardUrl = dep?.inspectorUrl
    || (dep?.uid ? `https://vercel.com/deployments/${dep.uid}` : null);

  const handleCopy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchDep(), fetchEvents()]);
    setRefreshing(false);
  };

  return (
    <div className="fs-detail">
      <div className="fs-detail-header">
        <button className="fs-link" onClick={onBack}>
          <ChevronLeft size={12} /> Deployments
        </button>
        <button
          className="fs-icon-btn"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh"
        >
          {refreshing ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />}
        </button>
      </div>

      {error && <div className="fs-error">{error}</div>}

      {loading && !dep ? (
        <div className="fs-empty"><Loader size={12} className="spin" /> Loading deployment…</div>
      ) : !dep ? (
        <div className="fs-empty">Deployment not found.</div>
      ) : (
        <>
          <div className="fs-detail-summary">
            <div className="fs-detail-url-row">
              <span className={`fs-state-pill ${state.cls}`}>{state.label}</span>
              {url ? (
                <span className="fs-detail-url" title={url}>{url.replace(/^https?:\/\//, "")}</span>
              ) : (
                <span className="fs-detail-url">—</span>
              )}
              {url && (
                <button className="fs-icon-btn" onClick={handleCopy} title="Copy URL">
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                </button>
              )}
              {url && (
                <a className="fs-icon-btn" href={url} target="_blank" rel="noopener noreferrer" title="Open in new tab">
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
            <div className="fs-detail-meta">
              {dep.target && <span>· {dep.target}</span>}
              {dep.creator?.username && <span>· {dep.creator.username}</span>}
              {dep.created && <span>· {new Date(dep.created).toLocaleString()}</span>}
            </div>
            {dashboardUrl && (
              <a
                className="fs-link fs-detail-vercel-link"
                href={dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Vercel <ExternalLink size={10} />
              </a>
            )}
          </div>

          <div className="fs-detail-tabs">
            <button
              className={`fs-tab ${tab === "preview" ? "is-active" : ""}`}
              onClick={() => setTab("preview")}
            >
              <Eye size={11} /> Preview
            </button>
            <button
              className={`fs-tab ${tab === "logs" ? "is-active" : ""}`}
              onClick={() => setTab("logs")}
            >
              <FileText size={11} /> Build Logs
            </button>
          </div>

          {tab === "preview" ? (
            url ? (
              <div className="fs-iframe-wrap">
                <iframe
                  src={url}
                  title="Deployment preview"
                  className="fs-iframe"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
                <div className="fs-iframe-hint">
                  Some sites block being embedded in frames — open in a new tab if the preview is blank.
                </div>
              </div>
            ) : (
              <div className="fs-empty">No URL available yet. Wait for the build to finish.</div>
            )
          ) : (
            <div className="fs-logs">
              {events.length === 0 ? (
                <div className="fs-empty">No log events.</div>
              ) : (
                <pre className="fs-log-pre">
                  {events.map((ev, i) => (
                    <div key={ev.id || i} className={`fs-log-line ${ev.type === "stderr" || /error/i.test(eventToLine(ev)) ? "is-err" : ""}`}>
                      {eventToLine(ev) || "·"}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DeploymentDetail;
