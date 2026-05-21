import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { closeUsersAdmin } from "../store/uiSlice";
import {
  useCreateAdminUserMutation,
  useDeleteAdminUserMutation,
  useGetAuthMeQuery,
  useListAdminUsersQuery,
  useRegenerateUserMcpTokenMutation,
  useUpdateAdminUserMutation,
  type AuthUser,
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [create, { isLoading, error }] = useCreateAdminUserMutation();

  const errMsg =
    error && "data" in error && (error.data as { error?: string })?.error
      ? (error.data as { error: string }).error
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
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
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
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
        <button type="submit" className="account-btn primary" disabled={isLoading}>
          {isLoading ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>
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
          <code title={showToken ? token : ""}>
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
  const [update, { isLoading, error }] = useUpdateAdminUserMutation();

  const errMsg =
    error && "data" in error && (error.data as { error?: string })?.error
      ? (error.data as { error: string }).error
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
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
      .then(() => onClose())
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
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="leave blank to keep current"
          />
        </label>
      </div>
      {errMsg && <div className="login-error">{errMsg}</div>}
      <div className="add-user-actions">
        <button type="button" className="account-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="account-btn primary" disabled={isLoading}>
          {isLoading ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
