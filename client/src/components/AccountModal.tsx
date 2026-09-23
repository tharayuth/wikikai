import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { closeAccount, openUsersAdmin, showToast } from "../store/uiSlice";
import { copyText } from "../lib/clipboard";
import {
  useGetAuthMeQuery,
  useRegenerateMcpTokenMutation,
} from "../store/api";
import { Avatar, CloseIcon, RoleBadge, formatDate, formatDateTime } from "./userUi";

/**
 * Account profile dialog reached from the topbar user widget. Shows
 * the current user's identity + their personal MCP API token, with
 * one-click copy and regenerate. Regenerate immediately invalidates
 * the previous token — any AI client configured with the old value
 * will start getting 401 from `/mcp`. Admins also get the entry point
 * to user management here.
 */
export function AccountModal(): JSX.Element | null {
  const open = useAppSelector((s) => s.ui.accountOpen);
  const dispatch = useAppDispatch();
  const { data } = useGetAuthMeQuery(undefined, { skip: !open });
  const [regen, { isLoading: regenerating }] = useRegenerateMcpTokenMutation();
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState<"token" | "config" | null>(null);

  useEffect(() => {
    if (!open) {
      setShowToken(false);
      return;
    }
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
    : "No token — regenerate to issue one";
  const configToken = showToken && token ? token : "<your-token>";
  const config = `{
  "mcpServers": {
    "wikikai": {
      "type": "http",
      "url": "${window.location.origin}/mcp",
      "headers": {
        "Authorization": "Bearer ${configToken}"
      }
    }
  }
}`;

  const copy = (what: "token" | "config", text: string) => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const onRegen = () => {
    if (!confirm("Regenerate your MCP token? The old token stops working immediately.")) {
      return;
    }
    regen()
      .unwrap()
      .then(() => {
        setShowToken(true);
        dispatch(showToast({ message: "New token issued", kind: "success" }));
      })
      .catch(() => undefined);
  };

  return (
    <div className="modal-backdrop show" onClick={() => dispatch(closeAccount())}>
      <div
        className="modal account-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
      >
        <div className="account-header">
          <div className="dialog-title">
            <h2 id="account-title">Your account</h2>
          </div>
          <button
            type="button"
            className="icon-btn dialog-close"
            aria-label="Close"
            onClick={() => dispatch(closeAccount())}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="account-body">
          <div className="account-profile">
            <Avatar name={user.display_name} size="lg" />
            <div className="account-profile-text">
              <div className="account-profile-name">
                {user.display_name}
                <RoleBadge admin={user.is_admin} />
              </div>
              <div className="account-profile-email">{user.email}</div>
              <div className="account-profile-meta">
                Joined {formatDate(user.created_at)}
                {user.last_login_at && (
                  <> · Last login {formatDateTime(user.last_login_at)}</>
                )}
              </div>
            </div>
          </div>

          {user.is_admin && (
            <div className="account-admin-card">
              <div>
                <strong>Users &amp; project access</strong>
                <span>Add people, reset passwords and choose which projects they see.</span>
              </div>
              <button
                type="button"
                className="account-btn"
                onClick={() => {
                  dispatch(closeAccount());
                  dispatch(openUsersAdmin());
                }}
              >
                Manage users →
              </button>
            </div>
          )}

          <section className="account-section-block">
            <h3 className="account-section">MCP API token</h3>
            <p className="account-help">
              Your AI client sends this as{" "}
              <code>Authorization: Bearer &lt;token&gt;</code> to{" "}
              <code>/mcp</code>. MCP activity is logged under your name.
              Regenerating invalidates every copy already in use.
            </p>
            <div className="token-field">
              <code className={`token-value${token ? "" : " empty"}`}>
                {showToken && token ? token : masked}
              </code>
              <div className="token-actions">
                <button
                  type="button"
                  className="account-btn"
                  onClick={() => setShowToken((v) => !v)}
                  disabled={!token}
                >
                  {showToken ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  className="account-btn"
                  onClick={() => copy("token", token)}
                  disabled={!token}
                >
                  {copied === "token" ? "Copied!" : "Copy"}
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
          </section>

          <section className="account-section-block">
            <div className="account-section-row">
              <h3 className="account-section">Example MCP config</h3>
              <button
                type="button"
                className="account-btn small"
                onClick={() => copy("config", config.replace("<your-token>", token))}
                disabled={!token}
                title="Copies the config with your real token filled in"
              >
                {copied === "config" ? "Copied!" : "Copy with token"}
              </button>
            </div>
            <pre className="account-code">{config}</pre>
          </section>
        </div>
      </div>
    </div>
  );
}
