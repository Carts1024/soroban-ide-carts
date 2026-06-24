import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader, Triangle, ShieldCheck, Sparkles, Zap, RefreshCw, AlertCircle } from "lucide-react";
import { useFullstack } from "../../context/FullstackContext";
import { startVercelOAuth, getVercelSession } from "../../services/backendService";

/**
 * "Connect with Vercel" — OAuth popup flow, single button.
 *
 * Phases:
 *   idle      → big "Connect with Vercel" button visible
 *   waiting   → popup is open, polling /vercel/oauth/me
 *   error     → backend unreachable / OAuth failed; show retry
 *
 * The Go backend hosts the OAuth dance; the popup redirects back through
 * /api/vercel/oauth/callback which writes a session cookie we then read.
 */
const VercelConnect = () => {
  const { setOAuthToken } = useFullstack();
  const [phase, setPhase] = useState("idle"); // "idle" | "waiting" | "error"
  const [error, setError] = useState(null);
  const popupRef = useRef(null);
  const pollRef = useRef(null);
  const timeoutRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }, []);

  useEffect(() => () => {
    stopPolling();
    if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
  }, [stopPolling]);

  const startPollingSession = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const sess = await getVercelSession();
        if (sess?.accessToken) {
          stopPolling();
          if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
          setOAuthToken(sess.accessToken, sess.user, sess.teamId);
        } else if (popupRef.current?.closed) {
          stopPolling();
          setPhase("idle");
        }
      } catch {
        // Transient errors are expected while the popup is still authenticating
        // — keep polling. We rely on the timeout below to surface a stuck flow.
      }
    }, 1500);

    // 3 minute hard cap so a stuck flow recovers without a refresh.
    timeoutRef.current = setTimeout(() => {
      stopPolling();
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
      setError("Connection timed out — please try again.");
      setPhase("error");
    }, 3 * 60 * 1000);
  }, [setOAuthToken, stopPolling]);

  const handleConnect = useCallback(async () => {
    setPhase("waiting");
    setError(null);
    try {
      const { authorizeUrl } = await startVercelOAuth();
      if (!authorizeUrl) throw new Error("Vercel sign-in is not configured on the server yet");

      const w = 560, h = 720;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      popupRef.current = window.open(
        authorizeUrl,
        "vercel-oauth",
        `width=${w},height=${h},left=${left},top=${top}`,
      );
      if (!popupRef.current) {
        throw new Error("Popup blocked — allow popups for this site and click Connect again.");
      }
      startPollingSession();
    } catch (err) {
      setError(err?.message || "Could not start Vercel sign-in. Please try again later.");
      setPhase("error");
    }
  }, [startPollingSession]);

  const handleCancel = useCallback(() => {
    stopPolling();
    if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    setPhase("idle");
    setError(null);
  }, [stopPolling]);

  return (
    <div className="fs-connect">
      <div className="fs-connect-hero">
        <div className="fs-vercel-mark">
          <Triangle size={36} fill="currentColor" />
        </div>
        <div className="fs-connect-title">Ship your fullstack app</div>
        <div className="fs-connect-sub">
          Connect Vercel to deploy your contract's UI in one click. Build the
          smart contract here, publish the website without leaving the IDE.
        </div>
      </div>

      <div className="fs-connect-actions">
        {phase === "waiting" ? (
          <>
            <button className="fs-btn fs-btn-primary fs-btn-lg" disabled>
              <Loader size={16} className="spin" />
              Waiting for Vercel...
            </button>
            <button className="fs-link" onClick={handleCancel}>Cancel</button>
          </>
        ) : (
          <>
            <button className="fs-btn fs-btn-primary fs-btn-lg" onClick={handleConnect}>
              <Triangle size={14} fill="currentColor" />
              {phase === "error" ? "Try again" : "Connect with Vercel"}
            </button>
            <div className="fs-secure-note">
              <ShieldCheck size={11} /> Sign-in opens in a Vercel popup. We never see your password.
            </div>
          </>
        )}

        {error && (
          <div className="fs-error fs-error-stack">
            <div className="fs-error-row"><AlertCircle size={12} /> {error}</div>
            <button className="fs-link" onClick={handleConnect}>
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        )}
      </div>

      <ul className="fs-bullets">
        <li>
          <Sparkles size={12} />
          <span><strong>Auto-detect</strong> — Next.js, Vite, Astro, SvelteKit and more.</span>
        </li>
        <li>
          <Zap size={12} />
          <span><strong>One-click deploy</strong> — bundle, upload, build and preview without leaving the IDE.</span>
        </li>
        <li>
          <Triangle size={12} fill="currentColor" />
          <span><strong>Native Vercel</strong> — your dashboard, custom domains, env vars and analytics still work.</span>
        </li>
      </ul>
    </div>
  );
};

export default VercelConnect;
