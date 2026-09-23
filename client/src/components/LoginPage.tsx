import { useState, type FormEvent } from "react";
import { useLoginMutation } from "../store/api";
import { BrandLogo } from "./BrandLogo";

/**
 * Standalone login screen — rendered by `<App>` when the auth-me query
 * reports `auth_enabled: true` and `user: null`. Submits to
 * `POST /api/auth/login`; on success the auth-me cache invalidates and
 * `<App>` swaps back to the normal portal layout.
 *
 * Independent of the portal header/sidebar, so the page works even
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
    if (isLoading) return;
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
    <div className="login-page" lang="th">
      <div className="login-shell">
        <header className="login-header">
          <BrandLogo className="login-logo" />
          <nav className="login-links" aria-label="ติดตาม WikiKai">
            <a className="login-social-link" href="https://www.facebook.com/profile.php?id=61573996881161" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
                <path d="M24 12a12 12 0 1 0-13.875 11.855V15.47H7.078V12h3.047V9.356c0-3.007 1.792-4.668 4.533-4.668 1.312 0 2.686.234 2.686.234v2.953h-1.513c-1.49 0-1.956.925-1.956 1.875V12h3.328l-.532 3.469h-2.796v8.386A12.003 12.003 0 0 0 24 12Z" />
              </svg>
              เพจผู้พัฒนา <span aria-hidden="true">↗</span>
            </a>
            <a className="login-social-link login-github" href="https://github.com/tharayuth/wikikai" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
                <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 .1.97 2.23 3.28 1.6.1-.73.39-1.23.71-1.51-2.5-.29-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.01-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.09 1.15a10.77 10.77 0 0 1 5.62 0c2.15-1.45 3.09-1.15 3.09-1.15.62 1.55.23 2.7.12 2.98.72.78 1.15 1.78 1.15 3.01 0 4.32-2.63 5.27-5.14 5.55.4.35.76 1.03.76 2.08v3.08c0 .3.2.65.77.54A11.25 11.25 0 0 0 12 .75Z" />
              </svg>
              GitHub <span aria-hidden="true">↗</span>
            </a>
          </nav>
        </header>

        <main className="login-main">
          <section className="login-intro" aria-labelledby="login-heading">
            <p className="login-eyebrow"><span aria-hidden="true" /> OPEN SOURCE · SELF-HOSTED</p>
            <h1 id="login-heading">จากบทสนทนากับ AI<br /><span>สู่ความรู้ที่ใช้ต่อได้</span></h1>
            <p className="login-description">
              WikiKai คือพื้นที่ความรู้แบบโอเพนซอร์ส ให้ AI ช่วยสร้างและอัปเดตเอกสาร
              ให้คนอ่าน เข้าใจ และต่อยอดร่วมกันได้ ในพื้นที่ที่คุณดูแลเอง
            </p>
          </section>

          <section className="login-card" aria-labelledby="login-form-heading">
            <span className="login-card-eyebrow">YOUR KNOWLEDGE SPACE</span>
            <h2 id="login-form-heading">ยินดีต้อนรับกลับ</h2>
            <p className="login-subtitle">เข้าสู่ระบบเพื่อเปิดพื้นที่ความรู้ของคุณ</p>
            <form onSubmit={onSubmit} className="login-form" aria-busy={isLoading}>
              <label>
                <span>อีเมลหรือชื่อผู้ใช้</span>
                <input
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </label>
              <label>
                <span>รหัสผ่าน</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {errMsg && <div className="login-error" role="alert">{errMsg}</div>}
              <button type="submit" className="login-submit" disabled={isLoading}>
                {isLoading ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
                {!isLoading && <span aria-hidden="true"> →</span>}
              </button>
            </form>
            <p className="login-access-note">ยังไม่มีบัญชี? ติดต่อผู้ดูแลพื้นที่นี้เพื่อขอสิทธิ์เข้าใช้งาน</p>
          </section>

          <section className="login-features" aria-label="จุดเด่นของ WikiKai">
            <img className="login-feature-art" src="/assets/login-features.webp" alt="" width="1942" height="809" />
            <ul className="login-feature-list">
              <li>
                <span className="login-feature-number" aria-hidden="true">01</span>
                <div>
                  <h2>ให้ AI ช่วยจัดการความรู้</h2>
                  <p>ค้น สร้าง และอัปเดตเอกสารผ่าน MCP</p>
                </div>
              </li>
              <li>
                <span className="login-feature-number" aria-hidden="true">02</span>
                <div>
                  <h2>เอกสารที่เห็นภาพ</h2>
                  <p>ตาราง กราฟ แผนภาพ ภาพ และไฟล์ในที่เดียว</p>
                </div>
              </li>
              <li>
                <span className="login-feature-number" aria-hidden="true">03</span>
                <div>
                  <h2>ชี้จุด แล้วคุยต่อ</h2>
                  <p>อ้าง ID ของเอกสาร หน้า หรือบล็อก ให้ AI ทำต่อได้ตรงจุด</p>
                </div>
              </li>
              <li>
                <span className="login-feature-number" aria-hidden="true">04</span>
                <div>
                  <h2>เก็บ Secret คู่กับคู่มือ</h2>
                  <p>เก็บรหัสผ่านหรือ token แบบเข้ารหัส เปิดด้วย passphrase</p>
                </div>
              </li>
            </ul>
          </section>
        </main>

        <footer className="login-footer">
          <p>ให้ AI ช่วยเรียบเรียง ให้คนต่อยอดความรู้</p>
          <span>Open source. Your data. Your space.</span>
        </footer>
      </div>
    </div>
  );
}
