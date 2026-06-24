import React, { useMemo } from "react";
import { RefreshCw, Loader, Plus, Triangle, Search } from "lucide-react";
import { useFullstack } from "../../context/FullstackContext";

const FRAMEWORK_LABELS = {
  nextjs: "Next.js",
  vite: "Vite",
  astro: "Astro",
  sveltekit: "SvelteKit",
  nuxtjs: "Nuxt",
  remix: "Remix",
  gatsby: "Gatsby",
  "create-react-app": "CRA",
  vue: "Vue",
};

const frameworkLabel = (key) =>
  FRAMEWORK_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Static");

const initialsOf = (name) => {
  if (!name) return "?";
  const parts = name.replace(/[-_]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
};

const hueOf = (id) => {
  let h = 0;
  for (let i = 0; i < (id || "").length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
};

/**
 * Project picker + team switcher. The list is fed by FullstackContext and
 * refreshed whenever the selected team changes.
 */
const ProjectList = ({ onCreateNew }) => {
  const {
    user,
    teams,
    selectedTeamId,
    selectTeam,
    projects,
    selectedProjectId,
    selectProject,
    refreshProjects,
    loading,
    error,
  } = useFullstack();

  const [query, setQuery] = React.useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.framework || "").toLowerCase().includes(q),
    );
  }, [projects, query]);

  return (
    <div className="fs-projects">
      <div className="fs-projects-header">
        <div className="fs-account">
          <Triangle size={11} fill="currentColor" />
          <select
            className="fs-account-select"
            value={selectedTeamId}
            onChange={(e) => selectTeam(e.target.value)}
            title="Team / personal account"
          >
            <option value="">{user?.username || user?.name || user?.email || "Personal"}</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name || t.slug}</option>
            ))}
          </select>
        </div>
        <button
          className="fs-icon-btn"
          onClick={refreshProjects}
          disabled={loading?.projects}
          title="Refresh"
        >
          {loading?.projects ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />}
        </button>
      </div>

      <div className="fs-search">
        <Search size={11} />
        <input
          className="fs-input fs-input-search"
          placeholder="Search projects..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <div className="fs-error">{error}</div>}

      {loading?.projects && projects.length === 0 ? (
        <div className="fs-empty"><Loader size={12} className="spin" /> Loading projects…</div>
      ) : filtered.length === 0 ? (
        <div className="fs-empty">
          {query ? "No projects match your search." : "No Vercel projects yet. Deploy your workspace to create one."}
        </div>
      ) : (
        <div className="fs-project-list">
          {filtered.map((p) => {
            const latest = p.latestDeployments?.[0];
            const stateClass = latest?.readyState === "READY"
              ? "fs-state-ready"
              : latest?.readyState === "ERROR"
                ? "fs-state-error"
                : latest?.readyState
                  ? "fs-state-building"
                  : "fs-state-unknown";
            const hue = hueOf(p.id);
            return (
              <button
                key={p.id}
                className={`fs-project-card ${selectedProjectId === p.id ? "is-selected" : ""}`}
                onClick={() => selectProject(p.id)}
              >
                <div
                  className="fs-project-mono"
                  style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 35%), hsl(${(hue + 60) % 360} 55% 25%))` }}
                >
                  {initialsOf(p.name)}
                </div>
                <div className="fs-project-meta">
                  <div className="fs-project-name-row">
                    <span className="fs-project-name">{p.name}</span>
                    {p.framework && (
                      <span className="fs-framework-badge">{frameworkLabel(p.framework)}</span>
                    )}
                  </div>
                  <div className="fs-project-sub">
                    <span className={`fs-state-dot ${stateClass}`} />
                    {latest?.url ? (
                      <span className="fs-project-url" title={latest.url}>
                        {latest.url.replace(/^https?:\/\//, "")}
                      </span>
                    ) : (
                      <span className="fs-project-url">No deployments yet</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <button className="fs-btn fs-btn-secondary fs-btn-block" onClick={onCreateNew}>
        <Plus size={12} /> Deploy current workspace as new project
      </button>
    </div>
  );
};

export default ProjectList;
