import { useState } from "react";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import {
  useAddShareUserMutation,
  useRemoveShareUserMutation,
  useSetShareProtectedMutation,
  type ShareStatus,
} from "../store/api";
import { expiryFromDays, formatExpiry, parseDays } from "../lib/shareDates";

/**
 * The password-gate half of the share dialog. Two modes for a live link:
 * open to anyone with it, or ask for one of this document's share users.
 * Users are throwaway (username + password + optional expiry in days) and
 * belong to this knowledge only — they are not portal accounts.
 */
export function ShareUsersPanel({
  kid,
  status,
}: {
  kid: number;
  status: ShareStatus;
}): JSX.Element {
  const dispatch = useAppDispatch();
  const [setProtected, protectState] = useSetShareProtectedMutation();
  const [addUser, addState] = useAddShareUserMutation();
  const [removeUser, removeState] = useRemoveShareUserMutation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [daysText, setDaysText] = useState("");

  const busy = protectState.isLoading || addState.isLoading || removeState.isLoading;
  const days = parseDays(daysText);
  const activeUsers = status.users.filter((u) => !u.expired);
  const fail = (action: string) => (e: unknown) => {
    const msg =
      typeof e === "object" && e && "data" in e
        ? String((e as { data?: { error?: string } }).data?.error ?? "")
        : "";
    dispatch(
      showToast({ message: msg ? `${action}ไม่สำเร็จ: ${msg}` : `${action}ไม่สำเร็จ`, kind: "error" }),
    );
  };

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (days === "invalid") return;
    addUser({ id: kid, username: username.trim(), password, expires_in_days: days })
      .unwrap()
      .then(() => {
        setUsername("");
        setPassword("");
        setDaysText("");
      })
      .catch(fail("เพิ่ม user"));
  };

  return (
    <div className="share-gate">
      <fieldset className="share-mode" disabled={busy}>
        <legend>ใครเปิดลิงก์ได้</legend>
        <label className="share-mode-option">
          <input
            type="radio"
            name="share-mode"
            checked={!status.protected}
            onChange={() =>
              setProtected({ id: kid, protected: false }).unwrap().catch(fail("เปลี่ยนโหมด"))
            }
          />
          <span>เปิดได้เลย — ใครมีลิงก์ก็อ่านได้</span>
        </label>
        <label className="share-mode-option">
          <input
            type="radio"
            name="share-mode"
            checked={status.protected}
            onChange={() =>
              setProtected({ id: kid, protected: true }).unwrap().catch(fail("เปลี่ยนโหมด"))
            }
          />
          <span>ต้องใส่ user + password ก่อนอ่าน</span>
        </label>
      </fieldset>

      {status.protected && activeUsers.length === 0 && (
        <p className="share-warn" role="alert">
          ยังไม่มี user ที่ใช้ได้ — ตอนนี้ไม่มีใครเปิดลิงก์นี้ได้ จนกว่าจะเพิ่ม user ด้านล่าง
        </p>
      )}

      <div className="share-users">
        <div className="share-users-head">
          <span>User สำหรับลิงก์นี้</span>
          <span className="share-users-note">
            {status.protected
              ? "ใช้ได้เฉพาะเอกสารนี้ ไม่เกี่ยวกับบัญชีระบบ"
              : "เก็บไว้ได้ แต่จะถูกถามก็ต่อเมื่อเลือกโหมดต้องใส่รหัส"}
          </span>
        </div>
        {status.users.length === 0 ? (
          <p className="share-hint">ยังไม่มี user</p>
        ) : (
          <table className="share-users-table">
            <thead>
              <tr>
                <th>user</th>
                <th>หมดอายุ</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {status.users.map((u) => (
                <tr key={u.id} className={u.expired ? "expired" : undefined}>
                  <td className="share-user-name">{u.username}</td>
                  <td className="share-user-exp">
                    {u.expires_at ? (
                      <>
                        {formatExpiry(u.expires_at)}
                        {u.expired && <span className="share-expired-tag">หมดอายุแล้ว</span>}
                      </>
                    ) : (
                      <span className="share-user-forever">ไม่หมดอายุ</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="account-btn small danger"
                      disabled={busy}
                      onClick={() =>
                        removeUser({ id: kid, uid: u.id }).unwrap().catch(fail("ลบ user"))
                      }
                      title={`ลบ ${u.username}`}
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form className="share-add-user" onSubmit={onAdd}>
          <div className="share-add-row">
            <input
              type="text"
              placeholder="user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={64}
              autoComplete="off"
              required
            />
            <input
              type="text"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              required
            />
            <input
              type="text"
              inputMode="numeric"
              className={`share-days${days === "invalid" ? " invalid" : ""}`}
              placeholder="วัน"
              title="จำนวนวันก่อนหมดอายุ — เว้นว่าง = ไม่หมดอายุ"
              value={daysText}
              onChange={(e) => setDaysText(e.target.value)}
            />
            <button
              type="submit"
              className="account-btn primary small"
              disabled={busy || !username.trim() || !password || days === "invalid"}
            >
              เพิ่ม
            </button>
          </div>
          <p className={`share-days-preview${days === "invalid" ? " invalid" : ""}`}>
            {days === "invalid"
              ? "จำนวนวันต้องเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป"
              : days == null
                ? "ไม่ระบุวัน = user นี้ไม่หมดอายุ"
                : `หมดอายุ ${formatExpiry(expiryFromDays(days).toISOString())} (อีก ${days} วัน)`}
          </p>
        </form>
      </div>
    </div>
  );
}
