import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { closeUsersAdmin, showToast } from "../store/uiSlice";
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
import {
  Avatar,
  CloseIcon,
  PasswordInput,
  RoleBadge,
  Segmented,
  apiErrorMessage,
  formatDate,
  formatDateTime,
} from "./userUi";

type Tab = "profile" | "access" | "token";
type Selection = { kind: "user"; id: number } | { kind: "add" } | null;

/**
 * Admin-only user management dialog, laid out master–detail: a searchable
 * user list on the left, the selected user on the right split into
 * Profile / Project access / MCP token tabs. Editors report unsaved state
 * up through `setDirty` so switching user or closing the dialog asks
 * before throwing edits away.
 *
 * The last admin is protected — the API refuses deletes and demotions
 * that would leave zero admins, and the UI disables those controls with
 * the reason spelled out.
 */
export function UsersAdminModal(): JSX.Element | null {
  const open = useAppSelector((s) => s.ui.usersAdminOpen);
  const dispatch = useAppDispatch();
  const me = useGetAuthMeQuery();
  const { data, isLoading } = useListAdminUsersQuery(undefined, { skip: !open });
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>("profile");
  const [query, setQuery] = useState("");
  // Narrow screens show either the list or the detail, never both.
  const [mobileDetail, setMobileDetail] = useState(false);
  // The list refetches after a create; until it lands, the new user
  // comes from the create response so the selection doesn't bounce.
  const [created, setCreated] = useState<AuthUser | null>(null);
  const dirty = useRef(new Set<string>());

  const setDirty = useCallback((key: string, isDirty: boolean) => {
    if (isDirty) dirty.current.add(key);
    else dirty.current.delete(key);
  }, []);

  const guard = useCallback((action: () => void) => {
    if (
      dirty.current.size > 0 &&
      !confirm("You have unsaved changes. Discard them?")
    ) {
      return;
    }
    dirty.current.clear();
    action();
  }, []);

  const close = useCallback(
    () => guard(() => dispatch(closeUsersAdmin())),
    [guard, dispatch],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const users = useMemo(() => {
    const list = data?.users ?? [];
    return created && !list.some((u) => u.id === created.id)
      ? [...list, created]
      : list;
  }, [data, created]);
  useEffect(() => {
    if (created && data?.users.some((u) => u.id === created.id)) setCreated(null);
  }, [created, data]);

  // Keep a valid selection: first user on open, and after the selected
  // user is deleted.
  useEffect(() => {
    if (!open) {
      setSelection(null);
      setMobileDetail(false);
      setQuery("");
      setCreated(null);
      return;
    }
    if (selection?.kind === "add") return;
    if (selection?.kind === "user" && users.some((u) => u.id === selection.id)) return;
    if (users.length > 0) setSelection({ kind: "user", id: users[0].id });
  }, [open, users, selection]);

  if (!open) return null;
  if (!me.data?.user?.is_admin) return null;

  const meId = me.data.user.id;
  const adminCount = users.filter((u) => u.is_admin).length;
  const q = query.trim().toLowerCase();
  const shown = q
    ? users.filter(
        (u) =>
          u.display_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      )
    : users;
  const selectedUser =
    selection?.kind === "user"
      ? users.find((u) => u.id === selection.id) ?? null
      : null;

  const selectUser = (id: number) => {
    if (selection?.kind === "user" && selection.id === id) {
      setMobileDetail(true);
      return;
    }
    guard(() => {
      setSelection({ kind: "user", id });
      setMobileDetail(true);
    });
  };

  const startAdd = () =>
    guard(() => {
      setSelection({ kind: "add" });
      setMobileDetail(true);
    });

  return (
    <div className="modal-backdrop show" onClick={close}>
      <div
        className="modal users-admin-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="users-admin-title"
      >
        <div className="account-header">
          <div className="dialog-title">
            <h2 id="users-admin-title">Manage users</h2>
            <span className="dialog-subtitle">
              {users.length} {users.length === 1 ? "user" : "users"} ·{" "}
              {adminCount} {adminCount === 1 ? "admin" : "admins"}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn dialog-close"
            aria-label="Close"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>

        <div className={`ua-layout${mobileDetail ? " show-detail" : ""}`}>
          <aside className="ua-list-pane" aria-label="Users">
            <div className="ua-list-tools">
              <input
                type="search"
                className="ua-search"
                placeholder="Search name or email…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search users"
              />
              <button
                type="button"
                className="account-btn primary"
                onClick={startAdd}
              >
                + Add user
              </button>
            </div>
            <ul className="ua-list">
              {shown.map((u) => {
                const active = selection?.kind === "user" && selection.id === u.id;
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      className={`ua-list-item${active ? " active" : ""}`}
                      aria-current={active ? "true" : undefined}
                      onClick={() => selectUser(u.id)}
                    >
                      <Avatar name={u.display_name} />
                      <span className="ua-list-text">
                        <span className="ua-list-name">
                          {u.display_name}
                          {u.id === meId && <span className="ua-you">you</span>}
                        </span>
                        <span className="ua-list-email">{u.email}</span>
                      </span>
                      {u.is_admin && <RoleBadge admin />}
                    </button>
                  </li>
                );
              })}
            </ul>
            {!isLoading && shown.length === 0 && (
              <div className="ua-empty">
                {users.length === 0 ? "No users yet." : "No users match."}
              </div>
            )}
          </aside>

          <section className="ua-detail">
            <button
              type="button"
              className="ua-back"
              onClick={() => guard(() => setMobileDetail(false))}
            >
              ← All users
            </button>
            {selection?.kind === "add" ? (
              <AddUserPanel
                setDirty={setDirty}
                onCancel={() =>
                  guard(() => {
                    setSelection(null);
                    setMobileDetail(false);
                  })
                }
                onCreated={(u) => {
                  dirty.current.clear();
                  setCreated(u);
                  setSelection({ kind: "user", id: u.id });
                  // A new member can't see anything until granted a project.
                  setTab(u.is_admin ? "profile" : "access");
                }}
              />
            ) : selectedUser ? (
              <UserDetail
                key={selectedUser.id}
                user={selectedUser}
                isSelf={selectedUser.id === meId}
                isLastAdmin={selectedUser.is_admin && adminCount <= 1}
                tab={tab}
                onTab={(t) => guard(() => setTab(t))}
                setDirty={setDirty}
              />
            ) : (
              <div className="ua-empty">Select a user.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

type SetDirty = (key: string, dirty: boolean) => void;

/** Reports `isDirty` to the dialog under `key`, and clears it on unmount. */
function useReportDirty(setDirty: SetDirty, key: string, isDirty: boolean): void {
  useEffect(() => {
    setDirty(key, isDirty);
  }, [setDirty, key, isDirty]);
  useEffect(() => () => setDirty(key, false), [setDirty, key]);
}

function UserDetail({
  user,
  isSelf,
  isLastAdmin,
  tab,
  onTab,
  setDirty,
}: {
  user: AuthUser;
  isSelf: boolean;
  isLastAdmin: boolean;
  tab: Tab;
  onTab: (t: Tab) => void;
  setDirty: SetDirty;
}): JSX.Element {
  const tabs: { id: Tab; label: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "access", label: "Project access" },
    { id: "token", label: "MCP token" },
  ];
  return (
    <div className="ua-user">
      <div className="ua-user-head">
        <Avatar name={user.display_name} size="lg" />
        <div className="ua-user-id">
          <div className="ua-user-name">
            {user.display_name}
            <RoleBadge admin={user.is_admin} />
            {isSelf && <span className="ua-you">you</span>}
          </div>
          <div className="ua-user-email">{user.email}</div>
          <div className="ua-user-meta">
            Joined {formatDate(user.created_at)} · Last login{" "}
            {user.last_login_at ? formatDateTime(user.last_login_at) : "never"}
          </div>
        </div>
      </div>

      <div className="ua-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`ua-tab${tab === t.id ? " active" : ""}`}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="ua-tab-panel" role="tabpanel">
        {tab === "profile" && (
          <ProfileTab
            user={user}
            isSelf={isSelf}
            isLastAdmin={isLastAdmin}
            setDirty={setDirty}
          />
        )}
        {tab === "access" &&
          (user.is_admin ? (
            <div className="ua-note">
              Admins have full access to every project. Change the role to
              Member under <strong>Profile</strong> to grant access per project.
            </div>
          ) : (
            <ProjectAccessEditor userId={user.id} setDirty={setDirty} />
          ))}
        {tab === "token" && <TokenTab user={user} />}
      </div>
    </div>
  );
}

function ProfileTab({
  user,
  isSelf,
  isLastAdmin,
  setDirty,
}: {
  user: AuthUser;
  isSelf: boolean;
  isLastAdmin: boolean;
  setDirty: SetDirty;
}): JSX.Element {
  const dispatch = useAppDispatch();
  const [name, setName] = useState(user.display_name);
  const [email, setEmail] = useState(user.email);
  const [isAdmin, setIsAdmin] = useState(user.is_admin);
  const [update, { isLoading, error, reset }] = useUpdateAdminUserMutation();
  const [del, { isLoading: deleting }] = useDeleteAdminUserMutation();

  const patch: { display_name?: string; email?: string; is_admin?: boolean } = {};
  if (name.trim() && name.trim() !== user.display_name) patch.display_name = name.trim();
  if (email.trim() && email.trim() !== user.email) patch.email = email.trim();
  if (isAdmin !== user.is_admin) patch.is_admin = isAdmin;
  const isDirty = Object.keys(patch).length > 0;
  useReportDirty(setDirty, "profile", isDirty);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty) return;
    if (
      isSelf &&
      patch.is_admin === false &&
      !confirm("Remove your own admin role? You will lose access to this dialog.")
    ) {
      return;
    }
    update({ id: user.id, ...patch })
      .unwrap()
      .then(() => dispatch(showToast({ message: "Profile saved", kind: "success" })))
      .catch(() => undefined);
  };

  const revert = () => {
    setName(user.display_name);
    setEmail(user.email);
    setIsAdmin(user.is_admin);
    reset();
  };

  const onDelete = () => {
    if (!confirm(`Delete user "${user.display_name}"? This cannot be undone.`)) return;
    del(user.id)
      .unwrap()
      .then(() =>
        dispatch(showToast({ message: `Deleted ${user.display_name}`, kind: "success" })),
      )
      .catch((err: unknown) =>
        dispatch(
          showToast({ message: apiErrorMessage(err) ?? "Delete failed", kind: "error" }),
        ),
      );
  };

  const errMsg = apiErrorMessage(error);
  const deleteBlocked = isSelf
    ? "You can't delete your own account."
    : isLastAdmin
      ? "The last admin can't be deleted."
      : null;

  return (
    <div className="ua-stack">
      <form className="ua-card" onSubmit={save}>
        <h3 className="ua-card-title">Details</h3>
        <div className="ua-fields">
          <label className="ua-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="ua-field">
            <span>Email / username</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <div className="ua-field ua-field-wide">
            <span>Role</span>
            <Segmented
              label="Role"
              value={isAdmin ? "admin" : "member"}
              options={[
                { value: "member", label: "Member" },
                { value: "admin", label: "Admin" },
              ]}
              disabled={isLastAdmin}
              onChange={(v) => setIsAdmin(v === "admin")}
            />
            <small className="ua-hint">
              {isLastAdmin
                ? "This is the last admin — promote someone else before demoting."
                : isAdmin
                  ? "Admins see every project and can manage users."
                  : "Members see only the projects granted under Project access."}
            </small>
          </div>
        </div>
        {errMsg && <div className="ua-error">{errMsg}</div>}
        <div className="ua-actions">
          <button
            type="button"
            className="account-btn"
            onClick={revert}
            disabled={!isDirty || isLoading}
          >
            Revert
          </button>
          <button
            type="submit"
            className="account-btn primary"
            disabled={!isDirty || isLoading}
          >
            {isLoading ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <PasswordCard user={user} setDirty={setDirty} />

      <div className="ua-card ua-danger">
        <div className="ua-danger-text">
          <h3 className="ua-card-title">Delete user</h3>
          <p>
            {deleteBlocked ??
              "Removes the account, signs it out everywhere and revokes its MCP token."}
          </p>
        </div>
        <button
          type="button"
          className="account-btn danger"
          onClick={onDelete}
          disabled={deleteBlocked !== null || deleting}
        >
          {deleting ? "Deleting…" : "Delete user"}
        </button>
      </div>
    </div>
  );
}

function PasswordCard({
  user,
  setDirty,
}: {
  user: AuthUser;
  setDirty: SetDirty;
}): JSX.Element {
  const dispatch = useAppDispatch();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [update, { isLoading, error }] = useUpdateAdminUserMutation();
  useReportDirty(setDirty, "password", password.length > 0);

  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;
  const canSubmit =
    !isLoading && password.length > 0 && confirmPassword === password;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    update({ id: user.id, password })
      .unwrap()
      .then(() => {
        setPassword("");
        setConfirmPassword("");
        dispatch(showToast({ message: "Password updated", kind: "success" }));
      })
      .catch(() => undefined);
  };

  const errMsg = apiErrorMessage(error);

  return (
    <form className="ua-card" onSubmit={submit}>
      <h3 className="ua-card-title">Set a new password</h3>
      <div className="ua-fields">
        <label className="ua-field">
          <span>New password</span>
          <PasswordInput value={password} onChange={setPassword} />
        </label>
        <label className="ua-field">
          <span>Confirm password</span>
          <PasswordInput
            value={confirmPassword}
            onChange={setConfirmPassword}
            invalid={mismatch}
          />
          {mismatch && <small className="ua-field-error">Passwords don't match</small>}
        </label>
      </div>
      {errMsg && <div className="ua-error">{errMsg}</div>}
      <div className="ua-actions">
        <button type="submit" className="account-btn primary" disabled={!canSubmit}>
          {isLoading ? "Saving…" : "Set password"}
        </button>
      </div>
    </form>
  );
}

function TokenTab({ user }: { user: AuthUser }): JSX.Element {
  const dispatch = useAppDispatch();
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regen, { isLoading: regenerating }] = useRegenerateUserMcpTokenMutation();

  const token = user.mcp_token ?? "";
  const masked = token
    ? `${token.slice(0, 6)}${"•".repeat(16)}${token.slice(-4)}`
    : "No token — regenerate to issue one";

  const onCopy = () => {
    if (!token) return;
    void copyText(token).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const onRegen = () => {
    if (
      !confirm(
        `Regenerate the MCP token for ${user.display_name}? Their current token stops working immediately.`,
      )
    ) {
      return;
    }
    regen(user.id)
      .unwrap()
      .then(() => {
        setShowToken(true);
        dispatch(showToast({ message: "New token issued", kind: "success" }));
      })
      .catch(() => undefined);
  };

  return (
    <div className="ua-card">
      <h3 className="ua-card-title">Personal MCP token</h3>
      <p className="ua-card-help">
        {user.display_name}'s AI clients send this as{" "}
        <code>Authorization: Bearer &lt;token&gt;</code>. MCP activity is logged
        under their name. Regenerating invalidates every copy already in use.
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
            onClick={onCopy}
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
    </div>
  );
}

function AddUserPanel({
  setDirty,
  onCancel,
  onCreated,
}: {
  setDirty: SetDirty;
  onCancel: () => void;
  onCreated: (u: AuthUser) => void;
}): JSX.Element {
  const dispatch = useAppDispatch();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [create, { isLoading, error }] = useCreateAdminUserMutation();
  useReportDirty(
    setDirty,
    "add",
    name.length > 0 || email.length > 0 || password.length > 0,
  );

  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;
  const canSubmit =
    !isLoading &&
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length > 0 &&
    confirmPassword === password;

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
      .then(({ user }) => {
        dispatch(
          showToast({
            message: isAdmin
              ? `Created ${user.display_name}`
              : `Created ${user.display_name} — now grant project access`,
            kind: "success",
          }),
        );
        onCreated(user);
      })
      .catch(() => undefined);
  };

  const errMsg = apiErrorMessage(error);

  return (
    <form className="ua-user" onSubmit={submit}>
      <div className="ua-user-head">
        <Avatar name={name || "?"} size="lg" />
        <div className="ua-user-id">
          <div className="ua-user-name">New user</div>
          <div className="ua-user-meta">
            They sign in with the email / username and password below.
          </div>
        </div>
      </div>
      <div className="ua-tab-panel">
        <div className="ua-card">
          <div className="ua-fields">
            <label className="ua-field">
              <span>Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label className="ua-field">
              <span>Email / username</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="user@example.com or alice"
                autoComplete="off"
              />
            </label>
            <label className="ua-field">
              <span>Password</span>
              <PasswordInput value={password} onChange={setPassword} required />
            </label>
            <label className="ua-field">
              <span>Confirm password</span>
              <PasswordInput
                value={confirmPassword}
                onChange={setConfirmPassword}
                required
                invalid={mismatch}
              />
              {mismatch && (
                <small className="ua-field-error">Passwords don't match</small>
              )}
            </label>
            <div className="ua-field ua-field-wide">
              <span>Role</span>
              <Segmented
                label="Role"
                value={isAdmin ? "admin" : "member"}
                options={[
                  { value: "member", label: "Member" },
                  { value: "admin", label: "Admin" },
                ]}
                onChange={(v) => setIsAdmin(v === "admin")}
              />
              <small className="ua-hint">
                {isAdmin
                  ? "Admins see every project and can manage users."
                  : "Members start with no projects — you grant access next."}
              </small>
            </div>
          </div>
          {errMsg && <div className="ua-error">{errMsg}</div>}
          <div className="ua-actions">
            <button type="button" className="account-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="account-btn primary" disabled={!canSubmit}>
              {isLoading ? "Creating…" : "Create user"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

type Level = "none" | "view" | "edit";
const LEVELS: { value: Level; label: string }[] = [
  { value: "none", label: "None" },
  { value: "view", label: "View" },
  { value: "edit", label: "Edit" },
];

/**
 * Per-project access for one member. The server's grants are the base;
 * local edits live in `draft` as overrides, so a background refetch
 * (e.g. a project added over SSE) never wipes changes in progress.
 */
function ProjectAccessEditor({
  userId,
  setDirty,
}: {
  userId: number;
  setDirty: SetDirty;
}): JSX.Element {
  const dispatch = useAppDispatch();
  const { data: projectsResp, isLoading: loadingProjects } = useListProjectsQuery();
  const { data: permsResp, isLoading: loadingPerms } = useListUserPermissionsQuery(userId);
  const [update, { isLoading: saving }] = useUpdateUserPermissionsMutation();
  const [draft, setDraft] = useState<Record<string, Level>>({});
  const [filter, setFilter] = useState("");

  const projects = useMemo(
    () =>
      [...(projectsResp?.projects ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [projectsResp],
  );
  const base = useMemo(() => {
    const m: Record<string, Level> = {};
    for (const pp of permsResp?.permissions ?? []) m[pp.project] = pp.level;
    return m;
  }, [permsResp]);

  const levelOf = (name: string): Level => draft[name] ?? base[name] ?? "none";
  const changed = projects.filter(
    (p) => p.name in draft && draft[p.name] !== (base[p.name] ?? "none"),
  );
  useReportDirty(setDirty, "access", changed.length > 0);

  const f = filter.trim().toLowerCase();
  const shown = f ? projects.filter((p) => p.name.toLowerCase().includes(f)) : projects;
  const counts = { none: 0, view: 0, edit: 0 };
  for (const p of projects) counts[levelOf(p.name)] += 1;

  const setLevel = (name: string, lvl: Level) =>
    setDraft((d) => ({ ...d, [name]: lvl }));

  const setShown = (lvl: Level) =>
    setDraft((d) => {
      const next = { ...d };
      for (const p of shown) next[p.name] = lvl;
      return next;
    });

  const save = () => {
    const permissions: ProjectPermission[] = [];
    for (const p of projects) {
      const lvl = levelOf(p.name);
      if (lvl !== "none") permissions.push({ project: p.name, level: lvl });
    }
    update({ userId, permissions })
      .unwrap()
      .then(() => {
        setDraft({});
        dispatch(showToast({ message: "Project access saved", kind: "success" }));
      })
      .catch((err: unknown) =>
        dispatch(
          showToast({ message: apiErrorMessage(err) ?? "Save failed", kind: "error" }),
        ),
      );
  };

  if (loadingProjects || loadingPerms) {
    return <div className="ua-empty">Loading…</div>;
  }
  if (projects.length === 0) {
    return <div className="ua-empty">No projects yet.</div>;
  }

  return (
    <div className="pa">
      <div className="pa-toolbar">
        <input
          type="search"
          className="ua-search"
          placeholder={`Filter ${projects.length} projects…`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter projects"
        />
        <div className="pa-summary" aria-live="polite">
          <span className="pa-count edit">{counts.edit} edit</span>
          <span className="pa-count view">{counts.view} view</span>
          <span className="pa-count none">{counts.none} none</span>
        </div>
      </div>

      <div className="pa-bulk">
        <span>{f ? `Set ${shown.length} shown to` : "Set all to"}</span>
        {LEVELS.map((l) => (
          <button
            key={l.value}
            type="button"
            className="account-btn small"
            onClick={() => setShown(l.value)}
            disabled={shown.length === 0}
          >
            {l.label}
          </button>
        ))}
      </div>

      <ul className="pa-list">
        {shown.map((p) => {
          const lvl = levelOf(p.name);
          const isChanged = p.name in draft && draft[p.name] !== (base[p.name] ?? "none");
          return (
            <li key={p.name} className={`pa-row${isChanged ? " changed" : ""}`}>
              <span className="pa-name" title={p.name}>
                {p.name}
              </span>
              <span className="pa-docs">
                {p.count} {p.count === 1 ? "doc" : "docs"}
              </span>
              <Segmented
                label={`Access to ${p.name}`}
                value={lvl}
                options={LEVELS}
                onChange={(v) => setLevel(p.name, v)}
                size="sm"
                tone
              />
            </li>
          );
        })}
        {shown.length === 0 && <li className="ua-empty">No projects match.</li>}
      </ul>

      <div className="pa-footer">
        <span className="pa-footer-status">
          {changed.length > 0
            ? `${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"}`
            : "All changes saved"}
        </span>
        <button
          type="button"
          className="account-btn"
          onClick={() => setDraft({})}
          disabled={changed.length === 0 || saving}
        >
          Revert
        </button>
        <button
          type="button"
          className="account-btn primary"
          onClick={save}
          disabled={changed.length === 0 || saving}
        >
          {saving ? "Saving…" : "Save access"}
        </button>
      </div>
    </div>
  );
}
