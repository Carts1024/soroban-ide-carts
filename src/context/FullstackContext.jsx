import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as vercel from "../services/vercelService";
import { getVercelSession, disconnectVercel } from "../services/backendService";
import {
  collectFrontendFiles,
  detectFrontendRoot,
  guessFramework,
  prepareUploadEntries,
  slugifyProjectName,
} from "../features/fullstack/fullstackBundler";

const FullstackContext = createContext(null);

// We deliberately do NOT persist the access token in localStorage — the Go
// backend owns the session cookie and we re-fetch the token via
// `/api/vercel/oauth/me` on every page load. Only non-secret UI selections
// are persisted client-side.
const TEAM_KEY = "soroban:vercel_team_id";
const PROJECT_KEY = "soroban:vercel_project_id";

const persistTeam = (teamId) => {
  try {
    if (teamId) localStorage.setItem(TEAM_KEY, teamId);
    else localStorage.removeItem(TEAM_KEY);
  } catch { /* ignore */ }
};
const persistProject = (projectId) => {
  try {
    if (projectId) localStorage.setItem(PROJECT_KEY, projectId);
    else localStorage.removeItem(PROJECT_KEY);
  } catch { /* ignore */ }
};

export const FullstackProvider = ({ children }) => {
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(() => {
    try { return localStorage.getItem(TEAM_KEY) || ""; } catch { return ""; }
  });

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    try { return localStorage.getItem(PROJECT_KEY) || ""; } catch { return ""; }
  });

  const [deployments, setDeployments] = useState([]);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState(null);

  const [loading, setLoading] = useState({});
  const [error, setError] = useState(null);

  // Deploy flow state — exposed so the UI can render progress without
  // owning the workflow.
  const [deployFlow, setDeployFlow] = useState(null);
  // { stage: "bundling"|"uploading"|"creating"|"polling"|"done"|"error",
  //   total?, uploaded?, deploymentId?, deploymentUrl?, message? }

  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const setLoadingKey = useCallback((key, value) => {
    setLoading((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── On mount, try to recover a backend-mediated OAuth session ─────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sess = await getVercelSession();
        if (cancelled) return;
        if (sess?.accessToken) {
          setToken(sess.accessToken);
          if (sess.teamId && !selectedTeamId) setSelectedTeamId(sess.teamId);
          if (sess.user) setUser(sess.user);
        }
      } catch { /* offline / not implemented yet — ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Whenever the token changes, refresh identity + teams ──────────────────
  useEffect(() => {
    if (!token) {
      setUser(null);
      setTeams([]);
      return;
    }
    let cancelled = false;
    setLoadingKey("identity", true);
    setError(null);
    Promise.all([vercel.getUser(token), vercel.listTeams(token)])
      .then(([u, t]) => {
        if (cancelled) return;
        setUser(u || null);
        setTeams(t || []);
      })
      .catch((err) => {
        if (cancelled) return;
        // 401/403 means the backend session has expired — bounce back to the
        // connect view instead of leaving the panel in a broken state.
        if (err.status === 401 || err.status === 403) {
          setToken("");
        }
        setError(err.message || "Failed to load Vercel identity");
      })
      .finally(() => { if (!cancelled) setLoadingKey("identity", false); });
    return () => { cancelled = true; };
  }, [token, setLoadingKey]);

  // ── Refresh projects when token or selected team changes ──────────────────
  const refreshProjects = useCallback(async () => {
    if (!token) return;
    setLoadingKey("projects", true);
    setError(null);
    try {
      const list = await vercel.listProjects(token, selectedTeamId || null);
      if (!aliveRef.current) return;
      setProjects(list);
      // Drop the stale selection if it isn't in the new list.
      if (selectedProjectId && !list.some((p) => p.id === selectedProjectId)) {
        setSelectedProjectId("");
        persistProject("");
      }
    } catch (err) {
      setError(err.message || "Failed to list projects");
    } finally {
      if (aliveRef.current) setLoadingKey("projects", false);
    }
  }, [token, selectedTeamId, selectedProjectId, setLoadingKey]);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  // ── Refresh deployments when project changes ──────────────────────────────
  const refreshDeployments = useCallback(async () => {
    if (!token || !selectedProjectId) {
      setDeployments([]);
      return;
    }
    setLoadingKey("deployments", true);
    setError(null);
    try {
      const list = await vercel.listDeployments(token, selectedTeamId || null, selectedProjectId, 30);
      if (!aliveRef.current) return;
      setDeployments(list);
    } catch (err) {
      setError(err.message || "Failed to list deployments");
    } finally {
      if (aliveRef.current) setLoadingKey("deployments", false);
    }
  }, [token, selectedTeamId, selectedProjectId, setLoadingKey]);

  useEffect(() => { refreshDeployments(); }, [refreshDeployments]);

  // ── Selectors with persistence ────────────────────────────────────────────
  const selectTeam = useCallback((teamId) => {
    setSelectedTeamId(teamId || "");
    persistTeam(teamId || "");
    // Team switch invalidates everything below.
    setSelectedProjectId("");
    persistProject("");
    setDeployments([]);
    setSelectedDeploymentId(null);
  }, []);

  const selectProject = useCallback((projectId) => {
    setSelectedProjectId(projectId || "");
    persistProject(projectId || "");
    setSelectedDeploymentId(null);
  }, []);

  const selectDeployment = useCallback((id) => {
    setSelectedDeploymentId(id || null);
  }, []);

  // ── Connect / disconnect ──────────────────────────────────────────────────
  const setOAuthToken = useCallback((accessToken, vercelUser, teamId) => {
    if (!accessToken) return;
    setToken(accessToken);
    if (vercelUser) setUser(vercelUser);
    if (teamId) {
      setSelectedTeamId(teamId);
      persistTeam(teamId);
    }
    // OAuth tokens come from the backend session — we deliberately don't
    // mirror them into localStorage. A page reload re-fetches via the
    // /vercel/oauth/me endpoint.
  }, []);

  const disconnect = useCallback(async () => {
    setToken("");
    setUser(null);
    setTeams([]);
    setProjects([]);
    setDeployments([]);
    setSelectedTeamId("");
    setSelectedProjectId("");
    setSelectedDeploymentId(null);
    persistTeam("");
    persistProject("");
    await disconnectVercel();
  }, []);

  // ── Deploy workspace → Vercel ─────────────────────────────────────────────
  /**
   * @param {Object} args
   * @param {Array}  args.treeData
   * @param {Object} args.fileContents
   * @param {Object} [args.projectOverride]  – { id, name } to deploy into an existing project
   * @param {string} [args.targetFolderId]   – override the auto-detected source folder
   * @param {Object} [args.env]              – { KEY: "value" } env vars
   * @param {string} [args.target]           – "production" | null
   */
  const deployWorkspace = useCallback(async (args) => {
    if (!token) throw new Error("Connect Vercel before deploying");
    const {
      treeData,
      fileContents,
      projectOverride,
      targetFolderId,
      env = {},
      target = null,
    } = args;

    // 1. Resolve which folder to deploy.
    let detection;
    if (targetFolderId) {
      const findById = (nodes) => {
        for (const n of nodes || []) {
          if (n.id === targetFolderId) return n;
          const hit = findById(n.children);
          if (hit) return hit;
        }
        return null;
      };
      const folder = findById(treeData);
      if (!folder) throw new Error("Selected folder not found");
      detection = { kind: "subfolder", folder, name: folder.name, path: folder.name };
    } else {
      detection = detectFrontendRoot(treeData);
    }
    if (detection.kind === "empty" || !detection.folder) {
      throw new Error("Workspace is empty");
    }

    // 2. Bundle + hash.
    setDeployFlow({ stage: "bundling", message: `Collecting ${detection.name}/...` });
    const files = collectFrontendFiles(detection.folder, fileContents);
    if (files.length === 0) {
      setDeployFlow({ stage: "error", message: "No deployable files found" });
      throw new Error("No deployable files found in the selected folder");
    }
    const entries = await prepareUploadEntries(files);

    // 3. Upload blobs.
    setDeployFlow({ stage: "uploading", uploaded: 0, total: entries.length });
    await vercel.uploadFiles(token, selectedTeamId || null, entries, (done, total) => {
      setDeployFlow({ stage: "uploading", uploaded: done, total });
    });

    // 4. Create the deployment.
    setDeployFlow({ stage: "creating", message: "Creating deployment..." });
    const project = projectOverride || (selectedProjectId
      ? projects.find((p) => p.id === selectedProjectId) || { id: selectedProjectId }
      : null);
    const framework = guessFramework(entries);
    const name = project?.name
      ? slugifyProjectName(project.name)
      : slugifyProjectName(detection.name);

    const filesForApi = entries.map(({ file, sha, size }) => ({ file, sha, size }));
    const created = await vercel.createDeployment(token, selectedTeamId || null, {
      name,
      projectId: project?.id,
      files: filesForApi,
      env,
      target,
      framework,
    });

    const deploymentId = created?.id || created?.uid;
    const deploymentUrl = created?.url ? `https://${created.url}` : null;
    setDeployFlow({ stage: "polling", deploymentId, deploymentUrl, message: "Building..." });

    // 5. Poll to terminal state.
    let final;
    try {
      final = await vercel.pollDeployment(token, selectedTeamId || null, deploymentId, {
        onTick: (dep) => {
          setDeployFlow((prev) => ({
            ...(prev || {}),
            stage: "polling",
            deploymentId,
            deploymentUrl: dep?.url ? `https://${dep.url}` : prev?.deploymentUrl,
            readyState: dep?.readyState || dep?.status,
          }));
        },
      });
    } catch (err) {
      setDeployFlow({ stage: "error", message: err.message, deploymentId, deploymentUrl });
      throw err;
    }

    const finalState = final?.readyState || final?.status;
    setDeployFlow({
      stage: finalState === "READY" ? "done" : "error",
      deploymentId,
      deploymentUrl: final?.url ? `https://${final.url}` : deploymentUrl,
      readyState: finalState,
      message: finalState === "READY" ? "Deployment ready" : `Deployment ${finalState?.toLowerCase() || "failed"}`,
    });

    // If the deploy implicitly created a project, attach the project so the
    // user lands on its dashboard view.
    if (!selectedProjectId && final?.projectId) {
      setSelectedProjectId(final.projectId);
      persistProject(final.projectId);
    }
    await refreshProjects();
    await refreshDeployments();
    return final;
  }, [token, selectedTeamId, selectedProjectId, projects, refreshProjects, refreshDeployments]);

  const clearDeployFlow = useCallback(() => setDeployFlow(null), []);

  const isConnected = useMemo(() => Boolean(token), [token]);

  const value = useMemo(() => ({
    token, isConnected, user,
    teams, selectedTeamId, selectTeam,
    projects, selectedProjectId, selectProject,
    deployments, selectedDeploymentId, selectDeployment,
    refreshProjects, refreshDeployments,
    loading, error,
    setOAuthToken, disconnect,
    deployFlow, deployWorkspace, clearDeployFlow,
  }), [
    token, isConnected, user,
    teams, selectedTeamId, selectTeam,
    projects, selectedProjectId, selectProject,
    deployments, selectedDeploymentId, selectDeployment,
    refreshProjects, refreshDeployments,
    loading, error,
    setOAuthToken, disconnect,
    deployFlow, deployWorkspace, clearDeployFlow,
  ]);

  return <FullstackContext.Provider value={value}>{children}</FullstackContext.Provider>;
};

export const useFullstack = () => {
  const ctx = useContext(FullstackContext);
  if (!ctx) throw new Error("useFullstack must be used within FullstackProvider");
  return ctx;
};
