import { useState } from "react";

/**
 * Login form a public reader sees when a share link is password protected.
 * Posts to the token-scoped login endpoint; on success the server sets the
 * per-link cookie and the parent refetches the document.
 */
export function ShareLogin({
  token,
  onSuccess,
}: {
  token: string;
  onSuccess: () => void;
}): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/share/${encodeURIComponent(token)}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (r.ok) {
        onSuccess();
        return;
      }
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.status === 429) setError("ลองผิดหลายครั้งเกินไป — รอสักครู่แล้วลองใหม่");
      else if (body.error === "expired") setError("user นี้หมดอายุแล้ว — ติดต่อผู้แชร์เพื่อขอ user ใหม่");
      else setError("user หรือ password ไม่ถูกต้อง");
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public-view">
      <form className="public-login" onSubmit={submit} aria-label="Sign in to view">
        <span className="public-brand">WikiKai</span>
        <h1>เอกสารนี้ต้องใส่รหัสก่อนอ่าน</h1>
        <p className="share-hint">ใช้ user และ password ที่ผู้แชร์ให้ไว้ (ไม่ใช่บัญชีระบบ)</p>
        <label>
          user
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label>
          password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p className="public-login-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="account-btn primary" disabled={busy || !username.trim() || !password}>
          {busy ? "กำลังตรวจสอบ…" : "เปิดอ่าน"}
        </button>
      </form>
    </div>
  );
}
