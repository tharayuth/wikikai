import { useState, type FormEvent } from "react";
import { useLoginMutation } from "../store/api";

/**
 * Standalone login screen — rendered by `<App>` when the auth-me query
 * reports `auth_enabled: true` and `user: null`. Submits to
 * `POST /api/auth/login`; on success the auth-me cache invalidates and
 * `<App>` swaps back to the normal portal layout.
 *
 * No header/sidebar — keep the screen minimal so the page works even
 * when the rest of the SPA wouldn't render (e.g. if anonymous reads
 * are forbidden). After login, the URL hash is preserved so the user
 * lands back on the page they were trying to view.
 */
export function LoginPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [login, { isLoading, error }] = useLoginMutation();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login({ email: email.trim(), password }).catch(() => {
      /* error surfaced via RTK Query state below */
    });
  };

  const errMsg =
    error && "data" in error && (error.data as { error?: string })?.error
      ? (error.data as { error: string }).error
      : error
        ? "Login failed"
        : null;

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/wikikai-logo.png" alt="WikiKai" className="login-logo" />
        <h1>WikiKai</h1>
        <p className="login-subtitle">Sign in to continue</p>
        <form onSubmit={onSubmit} className="login-form">
          <label>
            <span>Email or username</span>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {errMsg && <div className="login-error">{errMsg}</div>}
          <button type="submit" className="login-submit" disabled={isLoading}>
            {isLoading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
