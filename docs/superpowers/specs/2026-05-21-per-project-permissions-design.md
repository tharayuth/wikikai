# Per-Project Permissions + Activity-Log Live Refresh

**Date:** 2026-05-21
**Status:** Approved design, ready for plan
**Scope:** Add per-user view/edit access control scoped to projects, manageable
by admins only. Bundle a small UX fix: the Activity Log dialog auto-refreshes
when new entries are recorded while the dialog is open.

---

## 1. Motivation

WikiKai already has authenticated users (`WIKIKAI_WEB_AUTH=1`) and a per-user
MCP token, but once logged in every user can read and mutate every knowledge
document. The portal hosts multiple distinct projects (e.g. `Leaftech-AI`,
`isingleform`, `dev-process`) and the owner needs to give specific people
read-only or edit access to specific projects without exposing the rest.

A second papercut: the Activity Log dialog is a snapshot — if it is left open
while another tab / MCP client mutates a page, the dialog goes stale. SSE
infrastructure already exists for knowledge / page changes; activity-log
should ride the same channel.

## 2. Requirements (locked from brainstorming)

- **Default = deny.** A new non-admin user can see and edit nothing until an
  admin grants them at least one project.
- **Every knowledge document must belong to a project.** `knowledge.project`
  becomes required at the application layer (DB currently has zero NULL rows).
- **Three permission levels per (user × project):** `none` (no row) /
  `view` / `edit`.
- **Admin = automatic full access** to every project. Permission rows are
  ignored for admins. Only admins can manage permissions and only admins can
  create or delete projects.
- **Activity Log dialog auto-refreshes** when any new log row is recorded by
  any client (web or MCP) for a project the viewer can see.

## 3. Out of scope

- Sharing a single knowledge document outside its project's permission set.
- Per-page or per-block ACLs.
- "Owner" / "private" knowledge concept distinct from projects.
- Inviting users by email link / signup flow.
- Audit log specifically for permission grants (the existing activity log
  does not record permission changes; this can be added later if needed).
- Rate limiting or quota per user.

## 4. Data model

New table:

```sql
CREATE TABLE IF NOT EXISTS project_permissions (
  user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  project_name TEXT    NOT NULL REFERENCES projects(name) ON DELETE CASCADE
                                                           ON UPDATE CASCADE,
  level        TEXT    NOT NULL CHECK (level IN ('view','edit')),
  granted_at   TEXT    NOT NULL,
  granted_by   INTEGER          REFERENCES users(id)      ON DELETE SET NULL,
  PRIMARY KEY (user_id, project_name)
);
CREATE INDEX IF NOT EXISTS idx_pp_user ON project_permissions(user_id);
```

**Semantics**

- Missing row = `none` = no access. Deny-by-default falls out of "no row" —
  no special NULL handling.
- `ON DELETE CASCADE` on `user_id`: deleting a user wipes their grants.
- `ON DELETE CASCADE` on `project_name`: deleting a project wipes everyone's
  grants for it.
- `ON UPDATE CASCADE` on `project_name`: lets a future rename-project feature
  carry permissions along.
- `granted_by` is `ON DELETE SET NULL` so removing an admin doesn't break the
  audit trail.

**Knowledge.project becomes required (app-level)**

- DB column stays `TEXT NULL` to avoid an SQLite table rebuild; current row
  count of NULL projects is 0 so nothing breaks.
- Zod schemas for `add_knowledge` / `edit_knowledge` in
  `src/mcp/handlers.ts` switch `project` from optional to
  `z.string().min(1).max(100)`.
- `KnowledgeStore.add()` and `KnowledgeStore.update()` throw if `project`
  is empty / null.
- `POST /api/knowledge` rejects missing project with 400.
- A later schema migration can add a `CHECK (project IS NOT NULL)` once
  we're confident no client is still calling without one.

## 5. Authorisation core

A single helper `src/lib/permissions.ts`:

```ts
export type AccessLevel = "view" | "edit";

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertProjectAccess(
  user: User | null,
  project: string,
  need: AccessLevel,
  perms: PermissionStore,
): void {
  if (!user) throw new ForbiddenError("auth required");
  if (user.is_admin) return;
  const row = perms.get(user.id, project);
  if (!row) throw new ForbiddenError(`no access to project '${project}'`);
  if (need === "edit" && row.level !== "edit") {
    throw new ForbiddenError(`edit not allowed on project '${project}'`);
  }
}
```

**`PermissionStore`** (new, `src/store/permissions.ts`) owns the table:

- `get(user_id, project) → { level } | null`
- `listForUser(user_id) → [{ project, level }]`
- `replaceForUser(user_id, entries[], granted_by)` — atomic: delete all then
  bulk insert in one transaction.
- `listVisibleProjects(user_id, is_admin) → string[]` — admin returns all
  registered projects + distinct knowledge.project; non-admin returns the
  set from `project_permissions`.

A `ForbiddenError`-to-403 middleware sits next to the existing not-found
handler in `src/web/app.ts`.

## 6. Enforcement points

| Surface | Check |
|---|---|
| `GET /api/knowledge` | filter via SQL `WHERE project IN (visible_projects)` (admin = no filter) |
| `GET /api/knowledge/:id`, `/:id/outline` | resolve project of `:id` → `assertProjectAccess(view)` |
| `GET /api/pages/:pid`, `/:pid/rendered`, `/:pid/raw`, `/:pid/revisions` | resolve via `pages.knowledge_id` → project → view |
| `POST /api/knowledge` | `edit` on the project in the body |
| `PATCH /api/knowledge/:id`, `DELETE /api/knowledge/:id` | `edit` on the project of `:id` (and on the *new* project if PATCH renames it — must have edit on both) |
| `POST/PATCH/DELETE` on pages / tasks / images | `edit` on the page's project |
| `GET /api/search` | filter hits to visible projects (post-query filter is fine for FTS — small result set) |
| `GET /api/projects` | non-admin: only their visible projects; admin: all |
| `POST/DELETE /api/projects` | admin only (existing `requireAdmin` helper) |
| `GET /api/activity-log` | filter rows where `knowledge_id` is in a visible project; rows with `knowledge_id` NULL (e.g. image uploads not tied to a knowledge) → admin only |
| `/api/auth/*`, `/api/auth/me` | no project check (auth surfaces always open) |

**MCP** (`src/mcp/handlers.ts`): every handler that touches a knowledge or
page resolves the project and calls `assertProjectAccess` with the user from
`getCallContext().user_id`. Read tools (`list_knowledge`, `search`,
`get_outline`, `read_page`, `get_block`, `get_table_row`, …) filter by
visible projects or 403 when targeting one specific knowledge the caller
can't see.

`list_knowledge`, `search` results, and `get_prompt_log` are filtered the
same way as their web equivalents — same helper, same SQL.

## 7. UI

### 7.1 Permissions editor — inside `UsersAdminModal`

The existing per-row inline expand (`EditUserForm`) gains a new section
**Project access**, shown only when the edited user is *not* an admin:

```
Project access
  AI-Shared-Mem      ( ) none  (•) view  ( ) edit
  Leaftech-AI        (•) none  ( ) view  ( ) edit
  dev-process        ( ) none  ( ) view  (•) edit
  isingleform        (•) none  ( ) view  ( ) edit
  ...
  [ Set all → none ]  [ → view ]  [ → edit ]
```

- Radio group per project — three states clearly visible, no popovers.
- Bulk shortcuts at the bottom for fast initial setup.
- Admin users: section is replaced by an informational pill
  *"Admin — full access to all projects."*
- Project list is fetched from `/api/projects` (admin view → all projects).
- Save button POSTs the entire set; cancel reverts to last-fetched state.

### 7.2 API

```
GET    /api/admin/users/:id/permissions
       → { permissions: [{ project: "examples", level: "view" }, …] }

PUT    /api/admin/users/:id/permissions
       body: { permissions: [{ project, level: "view"|"edit" }, …] }
       → 200; replaces the whole set in one transaction; entries not
         listed = removed (= none)
```

Both routes use the existing `requireAdmin` guard from `attachAuthRoutes`.

### 7.3 Activity log auto-refresh

Add a new SSE event in `src/web/sse.ts`:

```ts
type ServerEvent = …
  | { type: "activity-logged"; knowledge_id: number | null };
```

- `ActivityLogStore.record()` broadcasts the event after insert. One emit
  call covers every mutation path; no per-handler plumbing.
- Client `useServerEvents.ts` adds a `case "activity-logged"` that
  invalidates `{ type: "ActivityLog", id: "LIST" }`. RTK Query refetches
  if-and-only-if the modal is mounted.
- Server-side filter on `/api/activity-log` (Section 6) means a user only
  receives rows they should see, so the auto-refresh is safe even when a
  mutation happens in a project the viewer can't access (their view simply
  doesn't change).

## 8. Migration & rollback

1. `schema.sql` gets `CREATE TABLE IF NOT EXISTS project_permissions …` +
   index appended. Existing `openDb()` migration path applies it on next
   start.
2. Zero rows of existing knowledge have NULL projects (verified
   2026-05-21). The Zod / store-level `project` requirement therefore
   doesn't break any existing call site.
3. Existing single admin (user #1) automatically gets full access (admin
   bypass); existing 22 knowledge documents remain readable by that admin
   immediately. No other users exist yet, so there is nothing else to
   backfill.
4. **Kill switch:** env var `WIKIKAI_PROJECT_ACL` (default `1`). When set
   to `0`, `assertProjectAccess` returns immediately — the system behaves
   as it did before this change. Useful as production hotfix while the
   admin debugs a misconfigured grant.

## 9. Testing

| Layer | File | What it covers |
|---|---|---|
| Unit | `test/permissions.test.ts` (new) | `assertProjectAccess` decision matrix (admin / view / edit / no-row × need view / need edit); `PermissionStore.replaceForUser` is atomic and idempotent |
| Integration | `test/web.test.ts` (extend) | non-admin alice gated out of read & write; view-only sees list+read but PATCH→403; edit can mutate; `/api/projects` filtered for non-admin; `POST /api/projects` admin-only |
| Integration | `test/web.test.ts` (extend) | `PUT /api/admin/users/:id/permissions` replaces atomically; idempotent; admin-only |
| Integration | `test/tools.test.ts` (extend) | MCP `add_knowledge` 403 when caller has no edit on the project; `list_knowledge` and `search` filter to visible projects; admin-token caller bypasses |
| SSE | `test/web.test.ts` (extend) | An `EventSource`-style listener on `/api/events` receives an `activity-logged` event within 500 ms of a successful `PATCH /api/pages/:pid` |
| Manual | — | Smoke: log in as alice with `examples` view-only; verify sidebar shows only `examples`, edit buttons hidden, activity-log dialog (left open) updates when admin edits a page in `examples`, does NOT add a row when admin edits a page in `isingleform` |

Coverage target: ≥ 80 % on the new files (`src/lib/permissions.ts` and
`src/store/permissions.ts`).

## 10. Documentation

Per repo convention (`CLAUDE.md` "Documenting a new feature"):

- `client/src/components/HelpModal.tsx` — add a permissions section in both
  EN and TH tabs.
- Tutorial knowledge `&4` — extend the auth tab to mention per-project
  access; bump stats card counts as appropriate.
- `~/.claude/skills/wikikai/SKILL.md` ↔ `docs/skill/SKILL.md` — note that
  MCP tools now respect per-user project ACLs (admin-token = no
  restrictions, member-token = filtered).
- `README.md` — short admin section: how to grant access.

## 11. Open questions

None — all settled during brainstorming.
