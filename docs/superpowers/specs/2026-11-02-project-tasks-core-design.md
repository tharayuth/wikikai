# Project Tasks Core

**Date:** 2026-11-02
**Status:** Draft, awaiting review
**Scope:** Per-project tasks with Board and List views, task dates on the
existing project calendar, and MCP tools that let an agent pick up work.

---

## 1. Motivation

WikiKai stores the documents that work produces, but has nowhere to track the
work itself. This adds a task system to each project, so an agent can be told "do
the next task on the board", and a person can see and reorder that work.

Page checkboxes (`- [ ]`, `toggle_task`) stay as they are. They suit a list
inside a document, but they cannot be assigned, scheduled or queried across a
project.

### 1.1 Sub-projects

The full idea is too large for one spec. Each part gets its own spec, plan and
release, in this order:

| Part | Contents |
|---|---|
| **Core (this spec)** | Tasks, Board, List, calendar dates, MCP tools, member list |
| **Team** | Comments, @mentions, in-app notifications |
| **Timeline** | Gantt view, dependencies between tasks |
| **External** | Read-only project link, with per-task visibility hidden by default |

### 1.2 Success criteria

- An agent can claim the next task over MCP, and a person sees the card move
  without reloading.
- Two agent sessions can never claim the same task.
- A member sees only the projects they have access to, and can assign work to
  other members of that project.
- A task's start and due dates appear on the project calendar.
- Nothing in this spec is reachable from a public share link.

## 2. Requirements (locked from brainstorming)

- **Tasks are rows in their own table**, not pages and not markdown table rows.
  Dragging a card must change one field, not rewrite a page and add a revision.
- **Tasks belong to a project**, not a document. They can link to wiki pages.
- **Four fixed statuses:** `todo`, `doing`, `review`, `done`. An agent needs
  their meaning to be certain, so columns are not configurable in Core.
- **Board order is priority.** There is no `priority` field, because two sources
  of order could not decide which task is next.
- **Agents pull work.** They claim the top eligible task, work on it, attach
  links and move it to `review`. A person moves it to `done`.
- **WikiKai does not start agents.** Moving a card triggers nothing.
- **The calendar icon stays the single entry point** to a project's views.

## 3. Data model

Added to `src/store/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',  -- markdown
  status         TEXT NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo','doing','review','done')),
  position       INTEGER NOT NULL,          -- order within its status
  assignee_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date     TEXT,                      -- YYYY-MM-DD
  due_date       TEXT,                      -- YYYY-MM-DD
  labels         TEXT,                      -- comma-separated, like knowledge.tags
  session_id     TEXT,                      -- claude --resume <id>
  blocked_reason TEXT,                      -- NULL = not blocked
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  archived_at    TEXT                       -- NULL = active
);
CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(project_id, status, position);

CREATE TABLE IF NOT EXISTS task_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  label      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_links(task_id);
```

Tasks reference `projects.id` because a rename keeps the id, while
`knowledge.project` and `project_permissions` key on the name.

Added by the in-place migration in `src/store/db.ts`, for the reason the
existing notes in `schema.sql` give:

```sql
ALTER TABLE activity_log ADD COLUMN project_id INTEGER;
ALTER TABLE activity_log ADD COLUMN task_id INTEGER;
ALTER TABLE activity_log ADD COLUMN task_title TEXT;
```

These columns are not foreign keys, because a log row outlives its target. Their
index, on `(project_id, created_at DESC)`, is created in `db.ts` after the
`ALTER`.

## 4. Rules

`src/store/tasks.ts` (`TaskStore`) enforces all of these, so MCP and REST cannot
drift apart.

### 4.1 Access

- `view` reads tasks. `edit` creates, changes, moves and claims them. Both use
  `assertProjectAccess`.
- A task id resolves to its project first, then the check runs on that project.
- Assignable members are users with `edit` on the project, plus admins. With the
  ACL disabled, every user is assignable.

### 4.2 Version and conflicts

- Each successful edit bumps `version` once and sets `updated_at`, however many
  fields it changed. Adding or removing a link and archiving also count. The one
  exception is a position-only change (see 4.3).
- `edit_task` and `PATCH` always require `expected_version`. The update runs as
  `UPDATE ... WHERE id = ? AND version = ?`, so of two callers holding the same
  version exactly one succeeds.
- A mismatch fails with `STALE: task T12 version mismatch: expected v3, current
  v4`, matching the existing page errors.
- An edit with no fields to change is a validation error.

### 4.3 Position

- Non-archived tasks in one project and status are renumbered from 1, in a
  transaction, whenever that status's order changes. Renumbering does not touch
  the `version` or `updated_at` of the other tasks.
- A new task goes to the bottom of its status.
- A status change places the task at the bottom of the new status, except `done`,
  which places it at the top so that recent work stays visible.
- `position: "top" | "bottom"` on `add_task` and `edit_task` overrides these
  defaults. A position-only edit does not bump `version`.
- Archived tasks keep a stale position and are ignored. Unarchiving places a task
  at the bottom of its status.

### 4.4 Next task

`next` returns at most one task, the first by `position` where:

```text
status = 'todo'
AND archived_at IS NULL
AND blocked_reason IS NULL
AND (assignee_id IS NULL OR assignee_id = <caller>)
```

With no caller identity, only unassigned tasks qualify. `next` cannot be combined
with other filters.

### 4.5 Project lifecycle

- A task's project cannot be changed in Core.
- The MCP tools accept a project known only through `knowledge.project` and
  register it first. `knowledge.ts` already registers projects when documents
  are written, so this is a safety net. An unknown name is an error, so a typo
  cannot create a project.
- `unregisterProject` raises a dedicated error when any task exists, archived
  ones included, and `DELETE /api/projects/:name` answers 409 saying how many. The
  check runs before the delete, because a raw constraint error would not produce
  that message. The FK's `RESTRICT` remains the backstop.

### 4.6 Validation

| Field | Rule |
|---|---|
| `title` | Required, 1 to 300 characters after trimming |
| `description` | Up to 20,000 characters. Long material belongs on a wiki page |
| `start_date`, `due_date` | A real `YYYY-MM-DD` date, and start must not be after due. Reuse `parseDate` from `calendar.ts` |
| `labels` | Up to 20, each up to 50 characters, no commas, trimmed and de-duplicated |
| `session_id` | Up to 200 characters |
| `blocked_reason` | Up to 1,000 characters |
| link `url` | Up to 2,000 characters. Must start with `http://` or `https://`, or with one `/` that is not followed by `/` or `\` |
| link `label` | Up to 200 characters |
| links per task | Up to 50 |

The link rule blocks `javascript:` and protocol-relative URLs, because links are
rendered into `<a href>`.

### 4.7 Delete

- `edit_task` archives and unarchives. MCP has no way to delete a task.
- `DELETE /api/tasks/:id` removes a task permanently. It is admin-only and answers
  409 unless the task is archived.

## 5. MCP tools

Four tools, registered in `src/mcp/server.ts` with schemas in
`src/mcp/handlers.ts`. Projects are named as `add_knowledge` names them.

| Tool | Inputs | Returns |
|---|---|---|
| `add_task` | `project`, `title`, and optionally `description`, `status`, `assignee`, `start_date`, `due_date`, `labels`, `links`, `session_id`, `position` | Full task |
| `list_tasks` | `project`, and optionally `status` (one or more), `assignee`, `label`, `include_archived`, `limit`, `next` | Compact rows |
| `get_task` | `task_id` | Full task |
| `edit_task` | `task_id`, `expected_version`, and any of the `add_task` fields except `project` and `links`, plus `blocked_reason`, `add_links`, `remove_link_ids`, `archived`. Nullable fields clear with `null` | Full task |

- **Full task:** every column in readable form, with `assignee` as
  `{ id, display_name }`, `labels` as an array, `links`, `archived` and `url`.
- **Compact row:** `id`, `title`, `status`, `assignee`, `due_date`, `labels`,
  `blocked_reason`, `version`, `url`. No description or links.
- **`list_tasks` defaults:** `todo`, `doing` and `review`, up to 100 rows (maximum
  500). A long-lived project's `done` tasks should not fill an agent's context.
- **`assignee`:** `"me"`, or a member's display name or email. When it is unknown
  or ambiguous, the error lists valid members by display name. Emails are accepted
  as input and never returned.

### 5.1 Agent flow

```text
list_tasks({ project: "docs", next: true })
  # returns T12 at version 3, or an empty list

edit_task({ task_id: 12, expected_version: 3, status: "doing",
            assignee: "me", session_id: "<uuid>" })
  # returns the full task
  # STALE means another session took it: start again from list_tasks

  ... do the work ...

edit_task({ task_id: 12, expected_version: 4, status: "review",
            add_links: [{ url: "https://github.com/org/repo/commit/abc",
                          label: "commit" }] })
```

An agent that gets stuck sets `blocked_reason` and stops. The task stays in
`doing`.

Moving to `done` is not blocked for agents, because a person may tell an agent to
do it. The tool description and `SKILL.md` say to finish at `review` and to set
`done` only when told. There is no claim timeout: a crashed session leaves its
card in Doing with its `session_id`, to resume or drag back.

### 5.2 Catalog

The catalog stands at 34,880 of the 40,000 characters allowed by
`test/mcp-catalog.test.ts`. The four tools are estimated at 3,500 to 4,500
characters. If they go over, trim the text rather than raise the budget. Reuse
`SESSION_NOTE`.

`toggle_task` keeps its name, because renaming would break clients. Its
description and the new tools' descriptions each state the difference between a
checkbox on a page and a task on a board.

## 6. REST API

Routes live in a new `src/web/taskRoutes.ts`, registered from `app.ts` before the
SPA catch-all. They sit behind the existing `requireAuth`.

```text
GET    /api/projects/:id/tasks      ?include_archived=1
POST   /api/projects/:id/tasks
GET    /api/projects/:id/members
GET    /api/tasks/:id
PATCH  /api/tasks/:id
DELETE /api/tasks/:id
GET    /api/tasks/:id/rendered
POST   /api/tasks/:id/move          { status, before_id, expected_version }
```

- `GET .../tasks` returns `{ project, can_edit, tasks }`. Rows are compact, plus
  `start_date`, `position` and `updated_at` for the views. `done` tasks are
  included because the calendar needs them. `can_edit` lets the client hide
  controls. The server still enforces access.
- `GET .../members` requires `view` and returns only `id` and `display_name`.
- `POST .../move` with `before_id: null` places the task at the bottom. If
  `before_id` is no longer in the target status, the task also goes to the bottom,
  so a slightly stale board does not fail the drag. `expected_version` is enforced
  only when the status changes.

| Status | Meaning |
|---|---|
| 400 | Validation failed |
| 401 | Not logged in (existing `requireAuth`) |
| 403 | `ForbiddenError` (existing mapping) |
| 404 | Project or task not found |
| 409 | Stale version, deleting a task that is not archived, or unregistering a project that has tasks |

## 7. Web UI

### 7.1 Entry and URL

The existing calendar icon in each sidebar project group is the only entry point.
Its tooltip becomes `Calendar and tasks of <project>`.

```text
/?calendar=<project_id>&month=YYYY-MM&view=board&task=<id>
```

- The `?calendar=` parameter is kept, so existing calendar links still work.
- `view` is `board` or `list`. Absent or invalid means the calendar.
- `task` opens the task modal over whichever view is showing.
- `withoutCalendar` also removes `view` and `task`, so the icon always opens the
  calendar.
- The `url` that MCP returns uses this form with `view=board`.

A new `ProjectView` replaces `CalendarView` in `App.tsx`. It renders a tab bar
(Calendar, Board, List) and the selected view.

### 7.2 Calendar

Tasks are added to the existing `CalendarView`. They come from the same
`GET .../tasks` query as the Board, so both refresh together. The calendar
endpoint is unchanged.

- **Bucketing:** a pure function in `client/src/lib/calendarGrid.ts` places each
  task on its due date and its start date. If the two match, it appears once as
  due. Tasks with no dates do not appear.
- **Dates are plain strings.** They are never converted between time zones, unlike
  page activity. Overdue compares against `todayLocal()`.
- **Day cell:** tasks come first and count toward `CELL_LINES`, and the rest fall
  into `+N more`. Each line shows a due or start marker, `T12` and the title.
- **Styling:** overdue (due before today and not `done`) uses `var(--red)`, `done`
  is muted with a strikethrough, and blocked tasks show a marker.
- **Interaction:** a cell with tasks but no pages still opens the day panel. The
  panel lists tasks above the knowledge groups, and clicking a task sets `task=`.
- **Filter:** a `Tasks` toggle joins the header, stored through `useStoredFlag` and
  on by default. `Created` and `Edited` do not affect tasks.
- **Stats:** the header line adds `N tasks due` for the shown month.
- **Failure:** if the task query fails while the calendar succeeds, pages still
  render and the header says the tasks could not be loaded.

### 7.3 Board

- Four columns. Cards show `T12`, title, assignee, due date, labels and a blocked
  marker.
- Dragging uses `@dnd-kit` with pointer and keyboard sensors, as `Sidebar.tsx`
  does, plus one `SortableContext` per column.
- The drop updates the RTK Query cache immediately. On failure the cache is
  restored and a toast explains why.
- Quick add at the bottom of Todo takes a title only.
- Done shows its first 20 cards, with a control to show more.
- Assignee and label filters apply to the Board and List. They are local state.
- Narrow screens scroll the columns horizontally.
- Without `can_edit`, dragging and quick add are disabled.

### 7.4 List

A table of id, title, status, assignee, due date, labels and updated time, sorted
and filtered on the client. A control includes archived tasks, which is the route
to unarchiving one.

### 7.5 Task modal

- Every field is editable, and the description has a rendered and an edit mode.
- A button copies `claude --resume <session_id>`.
- Links open normally. Relative wiki links navigate within the app.
- Archive and unarchive are available with `can_edit`. Admins can delete an
  archived task permanently.
- Without `can_edit`, the modal is read-only.
- A `task=` id that no longer exists shows `Task not found`, and the view behind it
  stays usable.

The description goes through `renderMarkdown`, then `useMermaidCharts` with no
`pageId`, so Mermaid and charts render without opening a fullscreen viewer.
Checkboxes render but are not clickable, because `toggle_task` is keyed by page.

All new CSS uses theme tokens. New view labels are English, matching `CalendarView`.

## 8. Changes to existing systems

### 8.1 Asset GC

`sweepOrphanedAssets` counts only page content as live, so an image referenced
only by a task description would be deleted after the grace period. This is
required work, not a follow-up.

- `sweepOrphanedAssets` reads task descriptions through the `db` it already takes,
  and unions those hashes into `liveRefs`. Archived tasks count. No caller changes,
  so none can forget to count tasks.
- It reuses `extractImageHashesSet` and `extractFileHashesSet`, so the patterns are
  shared rather than copied.
- `markDroppedRefs` is unchanged. It may stamp an asset that a task still uses, and
  the next sweep clears that stamp before anything is deleted.

### 8.2 Activity log

`target = 'task'` already means a checkbox toggle, so these rows use a new
`board_task` target with actions `add`, `edit`, `reorder` and `delete`. They set
`project_id`, `task_id` and `task_title`, and leave `knowledge_id` NULL. Bodies are
never logged.

- `ActivityLogStore.list` now hides rows with no `knowledge_id` from non-admins.
  The visibility condition must also match `project_id` against visible projects,
  or members would never see task activity.
- `ActivityLogModal.describeTarget` gains a `board_task` case linking to the task.
- `projectCalendar` needs no change, because it joins through `page_id`.

### 8.3 Live updates

Add `{ type: "task-changed"; project_id: number; task_id: number }` to
`WikikaiEvent`, emitted by `TaskStore` after commit, as the other stores do.
`/api/events` reaches every connected browser without project filtering, so the
event carries ids only.

`useServerEvents` invalidates new `Tasks` (by project) and `Task` (by id) tags, plus
the activity log. Both tags join `REFRESH_TAGS`.

### 8.4 Not changed

- **nginx:** no new streaming endpoint or large request body.
- **Share routes:** `/api/share/*` and `PublicView` are untouched.
- **`pages_fts`:** tasks are not indexed, because its rowid is `pages.id`.

## 9. Testing

| File | What it proves |
|---|---|
| `test/tasks.test.ts` | CRUD, validation limits, position and renumbering, version rules, `next` skipping blocked, archived and other people's tasks, two claims on one version with exactly one winner |
| `test/tasks-tools.test.ts` | The four tools, `assignee` resolution, `view` cannot edit, non-members are refused by task id, no email in any output |
| `test/tasks-web.test.ts` | Routes and status codes, anonymous refused, `javascript:` and `//host` links rejected, stale move answers 409, hard delete only when archived and admin, project unregister answers 409 |
| Orphan GC tests | An image only in a description survives past the grace period, and can be collected after the task is deleted |
| Activity log tests | A member sees `board_task` rows of their projects only, and `projectCalendar` ignores them |
| `test/db-migration.test.ts` | An older database gains the tables and columns with existing rows intact |
| `test/calendar.test.ts` | Task bucketing, same-day start and due shown once, overdue rule, old `?calendar=` URLs parse as before, `view` and `task` round-trip, `withoutCalendar` removes them |
| `test/mcp-catalog.test.ts` | The catalog stays under budget |

Then on the dev instance: the agent flow over real MCP, including two concurrent
claims, and a card moving in a second tab without a reload. Drag-and-drop in a real
browser needs a person if no browser is available to the agent.

## 10. Documentation and release

- `client/src/components/HelpModal.tsx`, EN and TH tabs.
- Tutorial `&4`, updated through production's MCP after the deploy.
- `docs/skill/SKILL.md` and the global copy, including the agent flow.
- `README.md`, and `AGENTS.md` (tool count and repo layout).
- **Exception:** the showcase `&3` is skipped. A board is not a block that can be
  embedded in a page, so there is nothing to demonstrate there.

Release as `v0.33.0` with a GitHub Release once `npm run typecheck` and `npm test`
pass. Deploying to production is a separate step, confirmed by the owner.

## 11. Known limits

- A description has no revision history, so an overwrite loses the old text. Content
  worth keeping belongs on a wiki page, which has revisions, linked from the task.
- Tasks are not searchable from the topbar.
- `list_tasks` covers one project at a time.
- `GET .../tasks` returns every non-archived task. This suits projects with hundreds
  of tasks. Paging can come when a real project needs it.
- A calendar cell shows a task's start and due dates, not a bar across the range.
  Timeline adds that.
- Tasks cannot be created or rescheduled from the calendar. It only displays them.
- There is no date recorded for when a task was completed.
