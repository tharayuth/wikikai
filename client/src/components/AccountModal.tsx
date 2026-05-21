import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { closeAccount } from "../store/uiSlice";
import {
  useGetAuthMeQuery,
  useRegenerateMcpTokenMutation,
} from "../store/api";

/**
 * Account profile dialog reached from the topbar user widget. Shows
 * the current user's identity + their personal MCP API token, with
 * one-click copy and regenerate. Regenerate immediately invalidates
 * the previous token — any AI client configured with the old value
 * will start getting 401 from `/mcp`.
 */
export function AccountModal(): JSX.Element | null {
  const open = useAppSelector((s) => s.ui.accountOpen);
  const dispatch = useAppDispatch();
  const { data } = useGetAuthMeQuery(undefined, { skip: !open });
  const [regen, { isLoading: regenerating }] = useRegenerateMcpTokenMutation();
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch(closeAccount());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dispatch]);

  if (!open) return null;
  const user = data?.user;
  if (!user) return null;

  const token = user.mcp_token ?? "";
  const masked = token
    ? `${token.slice(0, 6)}${"•".repeat(20)}${token.slice(-4)}`
    : "(none — regenerate to issue)";

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for non-secure origins where clipboard API is blocked
      const ta = document.createElement("textarea");
      ta.value = token;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
  };

  const onRegen = () => {
    if (!confirm("Regenerate your MCP token? The old token stops working immediately.")) {
      return;
    }
    regen()
      .unwrap()
      .then(() => setShowToken(true))
      .catch(() => undefined);
  };

  return (
    <div
      className="modal-backdrop show"
      onClick={() => dispatch(closeAccount())}
    >
      <div
        className="modal account-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Account"
      >
        <div className="account-header">
          <h2>Your account</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="close"
            onClick={() => dispatch(closeAccount())}
          >
            ×
          </button>
        </div>
        <div className="account-body">
          <dl className="account-info">
            <dt>Name</dt>
            <dd>{user.display_name}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Role</dt>
            <dd>{user.is_admin ? "Admin" : "Member"}</dd>
            <dt>Joined</dt>
            <dd>{new Date(user.created_at).toLocaleDateString()}</dd>
          </dl>

          <h3 className="account-section">MCP API token</h3>
          <p className="account-help">
            Send as <code>Authorization: Bearer &lt;token&gt;</code> in your AI
            client's <code>/mcp</code> config. Each user has one token —
            activity-log entries from MCP calls get tagged with whoever's
            token authorised the request. Regenerate any time to invalidate
            stale copies.
          </p>
          <div className="account-token-row">
            <code className="account-token" title={showToken ? token : "Show to reveal"}>
              {showToken ? token : masked}
            </code>
            <div className="account-token-actions">
              <button
                type="button"
                className="account-btn"
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                className="account-btn"
                onClick={copyToken}
                disabled={!token}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                type="button"
                className="account-btn danger"
                onClick={onRegen}
                disabled={regenerating}
              >
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          </div>

          <h3 className="account-section">Example MCP config</h3>
          <pre className="account-code">{`{
  "mcpServers": {
    "wikikai": {
      "type": "http",
      "url": "${window.location.origin}/mcp",
      "headers": {
        "Authorization": "Bearer ${showToken ? token : "<your-token-here>"}"
      }
    }
  }
}`}</pre>
        </div>
      </div>
    </div>
  );
}
