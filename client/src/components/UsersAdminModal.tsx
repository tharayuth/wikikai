import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { closeUsersAdmin } from "../store/uiSlice";
import { copyText } from "../lib/clipboard";
import {
  useCreateAdminUserMutation,
  useDeleteAdminUserMutation,
  useGetAuthMeQuery,
  useListAdminUsersQuery,
  useListProjectsQuery,
  useListUserPermissionsQuery,
  useRegenerateUserMcpTokenMutation,
  useUpdateAdminUserMutation,
  useUpdateUserPermissionsMutation,
  type AuthUser,
  type ProjectPermission,
} from "../store/api";

/**
 * Admin-only user management dialog. Lists every account; lets the
 * current admin add, edit, delete, or rotate the MCP token for any
 * user. The last admin is protected — the API refuses deletes and
 * demotions that would leave zero admins, and the UI greys those
 * controls out as a hint.
 */
export function UsersAdminModal(): JSX.Element | null {
  const open = useAppSelector((s) => s.ui.usersAdminOpen);
  const dispatch = useAppDispatch();
  const me = useGetAuthMeQuery();
  const { data } = useListAdminUsersQuery(undefined, { skip: !open });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch(closeUsersAdmin());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dispatch]);

  if (!open) return null;
  if (!me.data?.user?.is_admin) return null;

  const users = data?.users ?? [];
  const adminCount = users.filter((u) => u.is_admin).length;

  return (
    <div
      className="modal-backdrop show"
      onClick={() => dispatch(closeUsersAdmin())}
    >
      <div
        className="modal users-admin-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Manage users"
      >
        <div className="account-header">
          <h2>Manage users</h2>
          <button
            type="button"
            className="account-btn"
            onClick={() => setAdding(true)}
          >
            + Add user
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="close"
            onClick={() => dispatch(closeUsersAdmin())}
          >
            ×
          </button>
        </div>
        <div className="account-body">
          {adding && (
            <AddUserForm onClose={() => setAdding(false)} />
          )}
          <table className="users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email / username</th>
                <th>Role</th>
                <th>Last login</th>
                <th>MCP token</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  meId={me.data?.user?.id ?? -1}
                  adminCount={adminCount}
                />
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="users-admin-empty">No users yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddUserForm({ onClose }: { onClose: () => void }): JSX.Element {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [create, { isLoading, error }] = useCreateAdminUserMutation();

  const errMsg =
    error && "data" in error && (error.data as { error?: string })?.error
      ? (error.data as { error: string }).error
      : null;

  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;
  const missingConfirm = password.length > 0 && confirmPassword.length === 0;
  const showMismatchHint = mismatch;
  const canSubmit =
    !isLoading &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password === confirmPassword;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    create({
      email: email.trim(),
      display_name: name.trim(),
      password,
      is_admin: isAdmin,
    })
      .unwrap()
      .then(() => {
        setEmail("");
        setName("");
        setPassword("");
        setConfirmPassword("");
        setShowPassword(false);
        setShowConfirmPassword(false);
        setIsAdmin(false);
        onClose();
      })
      .catch(() => undefined);
  };

  return (
    <form className="add-user-form" onSubmit={submit}>
      <h3>Add user</h3>
      <div className="add-user-row">
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          Email / username
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="user@example.com or alice"
          />
        </label>
        <label>
          Password
          <PasswordInput
            value={password}
            onChange={setPassword}
            visible={showPassword}
            onToggleVisible={() => setShowPassword((v) => !v)}
            required
          />
        </label>
        <label>
          Confirm Password
          <PasswordInput
            value={confirmPassword}
            onChange={setConfirmPassword}
            visible={showConfirmPassword}
            onToggleVisible={() => setShowConfirmPassword((v) => !v)}
            required
            invalid={mismatch || missingConfirm}
          />
          {showMismatchHint && (
            <div className="password-mismatch">Passwords don't match</div>
          )}
        </label>
        <label className="add-user-admin">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
          />
          Admin
        </label>
      </div>
      {errMsg && <div className="login-error">{errMsg}</div>}
      <div className="add-user-actions">
        <button type="button" className="account-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="account-btn primary"
          disabled={!canSubmit}
        >
          {isLoading ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>
  );
}

/**
 * Password input with an inline show/hide eye toggle. Kept local to this
 * module so admin and self-service password fields share the same UX
 * without pulling in a new component file.
 */
function PasswordInput({
  value,
  onChange,
  visible,
  onToggleVisible,
  required,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  required?: boolean;
  placeholder?: string;
  invalid?: boolean;
}): JSX.Element {
  return (
    <div
      className={`password-input-wrap${invalid ? " password-input-wrap-invalid" : ""}`}
    >
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        autoComplete="new-password"
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={onToggleVisible}
        tabIndex={-1}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="eye-open"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="eye-off"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.77 19.77 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.86 19.86 0 0 1-3.17 4.19" />
      <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function UserRow({
  user,
  meId,
  adminCount,
}: {
  user: AuthUser;
  meId: number;
  adminCount: number;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [update] = useUpdateAdminUserMutation();
  const [del, { isLoading: deleting }] = useDeleteAdminUserMutation();
  const [regen, { isLoading: regenerating }] = useRegenerateUserMcpTokenMutation();

  const isLastAdmin = user.is_admin && adminCount <= 1;
  const isSelf = user.id === meId;
  const canDelete = !isSelf && !isLastAdmin;

  const onDelete = () => {
    if (!confirm(`Delete user "${user.display_name}"?`)) return;
    del(user.id).catch(() => undefined);
  };

  const onRegen = () => {
    if (
      !confirm(
        `Regenerate MCP token for ${user.display_name}? Their existing token stops working immediately.`,
      )
    )
      return;
    regen(user.id).catch(() => undefined);
  };

  const token = user.mcp_token ?? "";
  const masked = token
    ? `${token.slice(0, 4)}${"•".repeat(8)}${token.slice(-4)}`
    : "—";

  const onCopy = () => {
    if (!token) return;
    copyText(token).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      <tr>
        <td>{user.display_name}</td>
        <td>
          <code>{user.email}</code>
        </td>
        <td>
          <label className="role-toggle">
            <input
              type="checkbox"
              checked={user.is_admin}
              disabled={isLastAdmin}
              title={
                isLastAdmin
                  ? "Can't demote the last admin"
                  : user.is_admin
                    ? "Remove admin role"
                    : "Grant admin role"
              }
              onChange={(e) =>
                update({ id: user.id, is_admin: e.target.checked }).catch(
                  () => undefined,
                )
              }
            />
            <span>{user.is_admin ? "Admin" : "Member"}</span>
          </label>
        </td>
        <td className="users-table-meta">
          {user.last_login_at
            ? new Date(user.last_login_at).toLocaleString()
            : "never"}
        </td>
        <td className="users-table-token">
          <code
            className={showToken ? "token-full" : undefined}
            title={showToken ? token : ""}
          >
            {showToken ? token : masked}
          </code>
          <button
            type="button"
            className="account-btn small"
            onClick={() => setShowToken((v) => !v)}
            disabled={!token}
          >
            {showToken ? "Hide" : "Show"}
          </button>
          <button
            type="button"
            className="account-btn small"
            onClick={onCopy}
            disabled={!token}
            title="Copy MCP token to clipboard"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            className="account-btn small"
            onClick={onRegen}
            disabled={regenerating}
            title="Issue a new MCP token (the old one stops working)"
          >
            {regenerating ? "…" : "Regen"}
          </button>
        </td>
        <td className="users-table-actions">
          <button
            type="button"
            className="account-btn small"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            type="button"
            className="account-btn small danger"
            onClick={onDelete}
            disabled={!canDelete || deleting}
            title={
              isSelf
                ? "Can't delete yourself"
                : isLastAdmin
                  ? "Can't delete the last admin"
                  : "Delete user"
            }
          >
            {deleting ? "…" : "Delete"}
          </button>
        </td>
      </tr>
      {editing && (
        <tr className="users-table-edit-row">
          <td colSpan={6}>
            <EditUserForm user={user} onClose={() => setEditing(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

function EditUserForm({
  user,
  onClose,
}: {
  user: AuthUser;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(user.display_name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [update, { isLoading, error }] = useUpdateAdminUserMutation();

  const errMsg =
    error && "data" in error && (error.data as { error?: string })?.error
      ? (error.data as { error: string }).error
      : null;

  // Confirm matters only when a new password is being set. Empty means
  // "keep current" and bypasses confirm validation entirely.
  const changingPassword = password.length > 0;
  const mismatch = changingPassword && confirmPassword !== password;
  const missingConfirm = changingPassword && confirmPassword.length === 0;
  const showMismatchHint = changingPassword && (mismatch || missingConfirm);
  const canSubmit = !isLoading && (!changingPassword || !mismatch);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const patch: {
      id: number;
      display_name?: string;
      email?: string;
      password?: string;
    } = { id: user.id };
    if (name.trim() && name.trim() !== user.display_name)
      patch.display_name = name.trim();
    if (email.trim() && email.trim() !== user.email)
      patch.email = email.trim();
    if (password) patch.password = password;
    update(patch)
      .unwrap()
      .then(() => {
        setPassword("");
        setConfirmPassword("");
        setShowPassword(false);
        setShowConfirmPassword(false);
        onClose();
      })
      .catch(() => undefined);
  };

  return (
    <form className="add-user-form" onSubmit={submit}>
      <div className="add-user-row">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Email / username
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          New password
          <PasswordInput
            value={password}
            onChange={setPassword}
            visible={showPassword}
            onToggleVisible={() => setShowPassword((v) => !v)}
            placeholder="leave blank to keep current"
          />
        </label>
        <label>
          Confirm Password
          <PasswordInput
            value={confirmPassword}
            onChange={setConfirmPassword}
            visible={showConfirmPassword}
            onToggleVisible={() => setShowConfirmPassword((v) => !v)}
            placeholder="repeat new password"
            invalid={mismatch || missingConfirm}
          />
          {showMismatchHint && (
            <div className="password-mismatch">
              {mismatch ? "Passwords don't match" : "Please confirm the new password"}
            </div>
          )}
        </label>
      </div>
      {errMsg && <div className="login-error">{errMsg}</div>}
      <div className="add-user-actions">
        <button type="button" className="account-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="account-btn primary"
          disabled={!canSubmit}
        >
          {isLoading ? "Saving…" : "Save changes"}
        </button>
      </div>
      {!user.is_admin ? (
        <ProjectAccessSection userId={user.id} />
      ) : (
        <div className="project-access-admin-note">
          Admin — full access to all projects.
        </div>
      )}
    </form>
  );
}

type Level = "none" | "view" | "edit";

function ProjectAccessSection({ userId }: { userId: number }): JSX.Element {
  const { data: projectsResp } = useListProjectsQuery();
  const { data: permsResp } = useListUserPermissionsQuery(userId);
  const [update, { isLoading }] = useUpdateUserPermissionsMutation();

  const projects = projectsResp?.projects ?? [];

  const initial: Record<string, Level> = {};
  for (const p of projects) initial[p.name] = "none";
  for (const pp of permsResp?.permissions ?? []) initial[pp.project] = pp.level;

  const [state, setState] = useState<Record<string, Level>>(initial);

  useEffect(() => {
    const next: Record<string, Level> = {};
    for (const p of projects) next[p.name] = "none";
    for (const pp of permsResp?.permissions ?? []) next[pp.project] = pp.level;
    setState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsResp, permsResp]);

  const setAll = (lvl: Level) => {
    const next: Record<string, Level> = {};
    for (const p of projects) next[p.name] = lvl;
    setState(next);
  };

  const save = () => {
    const permissions: ProjectPermission[] = Object.entries(state)
      .filter(([, lvl]) => lvl !== "none")
      .map(([project, level]) => ({
        project,
        level: level as "view" | "edit",
      }));
    update({ userId, permissions }).catch(() => undefined);
  };

  return (
    <fieldset className="project-access">
      <legend>Project access</legend>
      {projects.map((p) => (
        <div key={p.name} className="project-access-row">
          <span className="project-access-name">{p.name}</span>
          {(["none", "view", "edit"] as Level[]).map((lvl) => (
            <label key={lvl}>
              <input
                type="radio"
                checked={state[p.name] === lvl}
                onChange={() => setState((s) => ({ ...s, [p.name]: lvl }))}
              />
              {lvl}
            </label>
          ))}
        </div>
      ))}
      <div className="project-access-bulk">
        <span>Set all →</span>
        <button type="button" onClick={() => setAll("none")}>
          none
        </button>
        <button type="button" onClick={() => setAll("view")}>
          view
        </button>
        <button type="button" onClick={() => setAll("edit")}>
          edit
        </button>
      </div>
      <div className="project-access-actions">
        <button
          type="button"
          className="account-btn primary"
          onClick={save}
          disabled={isLoading}
        >
          {isLoading ? "Saving…" : "Save access"}
        </button>
      </div>
    </fieldset>
  );
}
