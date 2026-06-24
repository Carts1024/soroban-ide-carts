import { useCallback, useEffect, useState } from "react";
import { signTransaction } from "@stellar/freighter-api";
import {
  contractId,
  invokeWrite,
  networkLabel,
  simulate,
} from "./sorobanClient";
import { useWallet } from "./wallet";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; label: string }
  | { kind: "error"; message: string }
  | { kind: "ok"; message: string };

const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);

const App = () => {
  const { address, detecting, connect } = useWallet();
  const [count, setCount] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const refresh = useCallback(async () => {
    if (!contractId) return;
    if (!address) {
      setCount(null);
      return;
    }
    setStatus({ kind: "loading", label: "Reading counter" });
    try {
      const value = await simulate<number | bigint>("get", address);
      setCount(Number(value));
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [address]);

  useEffect(() => {
    if (!detecting) refresh();
  }, [refresh, detecting]);

  const handleConnect = async () => {
    setStatus({ kind: "loading", label: "Connecting Freighter" });
    try {
      await connect();
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const runWrite = async (method: "increment" | "decrement" | "reset", label: string) => {
    if (!address) return;
    setStatus({ kind: "loading", label });
    try {
      const next = await invokeWrite<number | bigint>(method, address, signTransaction);
      setCount(Number(next));
      setStatus({ kind: "ok", message: `${label} confirmed` });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <span className="logo">★</span>
          <span>Soroban Counter</span>
        </div>
        <div className="header-actions">
          <span className="network-pill">{networkLabel}</span>
          {address ? (
            <span className="wallet-pill" title={address}>
              <span className="dot" /> {short(address)}
            </span>
          ) : detecting ? (
            <span className="wallet-pill wallet-pill-detecting">Detecting wallet…</span>
          ) : (
            <button className="btn btn-primary" onClick={handleConnect}>
              Connect Freighter
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {!contractId ? (
          <div className="empty-card">
            <div className="empty-title">No contract linked yet</div>
            <div className="empty-sub">
              Deploy the counter contract in the Soroban IDE <strong>Deploy</strong> panel,
              then click <strong>Rebuild</strong> in Preview. The contract ID is picked up
              automatically — no manual <code>.env</code> editing required.
            </div>
          </div>
        ) : (
          <>
            <section className="count-card">
              <div className="count-label">Current value</div>
              <div className="count-value">{count === null ? "—" : count.toLocaleString()}</div>
              <div className="count-id" title={contractId}>
                <code>{short(contractId)}</code>
              </div>
            </section>

            <section className="actions">
              <button className="btn btn-large" onClick={() => runWrite("increment", "Incrementing")} disabled={!address}>
                +1 Increment
              </button>
              <button className="btn btn-large" onClick={() => runWrite("decrement", "Decrementing")} disabled={!address}>
                −1 Decrement
              </button>
              <button className="btn btn-ghost btn-large" onClick={() => runWrite("reset", "Resetting")} disabled={!address}>
                Reset to 0
              </button>
              <button className="btn btn-ghost" onClick={refresh} disabled={!address}>
                Refresh
              </button>
            </section>

            {!address && !detecting && (
              <p className="hint">
                Connect Freighter in the Deploy panel or click <strong>Connect Freighter</strong> above.
                Your wallet address is picked up automatically when available.
              </p>
            )}

            {status.kind === "loading" && (
              <div className="status status-loading">
                <span className="spinner" /> {status.label}…
              </div>
            )}
            {status.kind === "ok" && <div className="status status-ok">{status.message}</div>}
            {status.kind === "error" && <div className="status status-error">{status.message}</div>}
          </>
        )}
      </main>

      <footer className="footer">
        Deployed via{" "}
        <a href="https://vercel.com" target="_blank" rel="noopener noreferrer">
          Vercel
        </a>{" "}
        · Built in Soroban IDE
      </footer>
    </div>
  );
};

export default App;
