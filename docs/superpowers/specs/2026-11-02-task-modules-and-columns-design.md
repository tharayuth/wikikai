# Task Modules and Columns

**Date:** 2026-11-02
**Status:** Approved by the owner, implemented
**Scope:** Split a project's tasks into modules, each with its own board. Let
people add columns to a board. Make the four built-in columns visibly locked.
**Builds on:** [Project Tasks Core](2026-11-02-project-tasks-core-design.md)

---

## 1. Motivation

A project's board holds every task in one place, so a project with several areas
of work becomes a single long queue. Its four columns also cannot express a team's
own steps, such as a backlog or a QA stage.

This spec adds both, without changing what a status means to an agent.

### 1.1 Names

- **Module**, not section, because `edit_section` already means something else in
  this product.
- **Column**, not list, because a project already has a `List` tab.

### 1.2 Success criteria

- A project can be split into modules, and each module shows its own board.
- A person can add, rename, reorder and delete their own columns.
- The four built-in columns cannot be renamed or deleted, and look different from
  added columns in both themes.
- An agent that never mentions a module or column behaves exactly as it does today.
- Existing tasks keep their board order after the migration.

## 2. Requirements (locked from brainstorming)

- **Modules are separate boards.** A module is not a filter or a label. Each task
  belongs to exactly one module.
- **All four built-in columns are locked in every module:** Todo, Doing, Review
  and Done.
- **`status` stays the source of truth for workflow.** A column is a place within
  one status, so the agent's meaning of the four statuses cannot drift. Core's rule
  of four fixed statuses stands. Its statement that columns are not configurable is
  replaced by this spec.
- **Agents cannot change the board's structure.** They can place tasks in existing
  modules and columns. Only people create, rename, reorder or delete them, through
  the portal.

## 3. Data model

Added to `src/store/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS task_modules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_modules_name
  ON task_modules(project_id, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS task_columns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id  INTEGER NOT NULL REFERENCES task_modules(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('todo','doing','review','done')),
  position   INTEGER NOT NULL,   -- within its status; the locked column counts as 0
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_columns_name
  ON task_columns(module_id, name COLLATE NOCASE);
```

Added by the in-place migration in `src/store/db.ts`:

```sql
ALTER TABLE tasks ADD COLUMN module_id INTEGER REFERENCES task_modules(id) ON DELETE RESTRICT;
ALTER TABLE tasks ADD COLUMN column_id INTEGER REFERENCES task_columns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(module_id, status, column_id, position);
```

- **Locked columns have no row.** `column_id IS NULL` means the locked column of the
  task's status. Nothing stored can rename or delete a locked column.
- **`project_id` cascades on purpose.** `unregisterProject` already refuses a project
  that has tasks, so the cascade only removes empty modules. `RESTRICT` here would
  stop a project from being unregistered once anyone had opened its board.
- **`module_id` is nullable in SQL only.** SQLite cannot add a `NOT NULL` column with
  a foreign key to an existing table. The store and the backfill below guarantee a
  value.

### 3.1 Invariants

`TaskStore` keeps these true after every write:

- A task's `module_id` is never NULL, and its module is in the task's project.
- When `column_id` is set, that column's `module_id` and `status` match the task's.

### 3.2 Migration

The `ALTER`s and the index run once, guarded by `hasColumn`. The backfill runs on
every open and is cheap when there is nothing to do:

1. Find the projects that have tasks with `module_id IS NULL`.
2. Give each the first module it has, creating `General` if it has none.
3. Set those tasks' `module_id`.
4. Clear `column_id` on any task whose column no longer matches its status or module.

Positions do not change. Before the migration, order was per project and status.
Afterwards all those tasks sit in one module's locked columns, so each keeps its
place.

The backfill runs on every open for rollback: code from before this spec can still
open the database, but it inserts tasks with no module and changes status without
clearing `column_id`. The next open under this spec repairs both. An old build also
renumbers across modules when it places a card, so a rollback can blend card order
between modules. It cannot lose a task.

### 3.3 Units

| File | Responsibility |
|---|---|
| `src/store/taskModules.ts` (new) | `TaskModuleStore`: module and column CRUD including moving a deleted column's cards, ordering, the default module, resolving names to ids |
| `src/store/tasks.ts` | Where a task lands (section 4.3), version rules, `next`. Resolves and validates modules and columns through `TaskModuleStore` |
| `src/web/taskRoutes.ts` | The new routes, sharing its access and error helpers |
| `client/src/lib/taskBoard.ts` | Pure board logic: column order, drop resolution, optimistic moves |
| `client/src/components/ModuleBar.tsx` (new) | The module bar and its menu |
| `client/src/components/BoardControls.tsx` (new) | The `⋯` menu and inline name form that modules and columns share |
| `client/src/components/TaskBoard.tsx` | Renders columns from the pure functions, plus the column header and menu |

## 4. Rules

### 4.1 Modules

- A project gets its first module, `General`, the first time its modules are read or
  a task is added. Creating it is not logged and emits no event. From then on the
  project always has at least one module.
- `position` runs from 1 in bar order. A new module goes last.
- A module can be renamed and moved left or right.
- A module can be deleted only when it has no tasks, archived ones included, and is
  not the project's last. Its custom columns go with it. The error says how many tasks
  remain.

### 4.2 Columns

- A custom column's `status` is chosen at creation and never changes. To change it,
  delete the column and add another.
- Columns display in status order: Todo, Doing, Review, Done. Within one status they
  sort by `position`. The locked column counts as 0, so columns before it are negative
  and columns after it are positive.
- A new column goes last in its status: `max(position, 0) + 1`.
- Moving left or right swaps a column with its neighbour within its status, the locked
  column included, then renumbers so the locked column stays at 0. A column cannot leave
  its status.
- A move past the edge of the bar or the status changes nothing and succeeds, so a
  slightly stale screen does not fail. This matches `before_id` in Core.
- **Deleting a column moves its cards to the bottom of the locked column of the same
  status**, keeping their relative order. This is one transaction and bumps no versions.
  Archived tasks in that column have their `column_id` cleared as well.

### 4.3 Where a task lands

One rule set serves `add`, `edit` and `move`, so MCP and REST cannot disagree.

**Target module:** the one given, otherwise the task's current module. A new task with
none given goes to the project's first module.

**Target status:** the one given, otherwise the task's current status. A new task's
default is `todo`. A column given by the table below sets the status instead.

**Target column:**

| Input | Result |
|---|---|
| A custom column | That column, which must be in the target module. Status becomes the column's status |
| A locked column by name (MCP only) | The locked column of that name. Status becomes that status |
| `column: null` | The locked column of the target status |
| No column, on a new task or when the module or status changes | The locked column of the target status |
| No column, on an existing task when neither changes | The task stays where it is |

- An explicit `status` that disagrees with the given column is an error. It is never
  silently resolved.
- A column from another module or project is an error.

**Position in the column:** the bottom, or the top when the status is `done`, because
Done is paged and recent work should stay visible. `position` on `add_task` or
`edit_task` overrides this, and `before_id` on `move` sets it exactly. Naming the
current module or column is accepted and does not move the card.

An archived task records its module and column but is not placed. Unarchiving places it
at the bottom of its column.

### 4.4 Version

Core's rules stand. This adds one: **module and column are placement, like `position`.**

- A change to module or column alone does not bump `version` or set `updated_at`, and
  is logged as `reorder`.
- A status change is still a field change. It bumps `version`, even when it happens by
  moving to a column in another status.
- `move` still checks `expected_version` only when the status changes. `edit` still
  always checks it.

So a person moving a card from Doing to a custom column in the same status cannot fail
an agent's claim or its next edit.

### 4.5 Position

Core's rules apply per column rather than per status. `place` renumbers the
non-archived tasks in one module, status and `column_id`. A `before_id` not in the
target column means the bottom.

### 4.6 Next task

`next` takes tasks from locked Todo columns only:

```text
status = 'todo'
AND column_id IS NULL
AND archived_at IS NULL
AND blocked_reason IS NULL
AND (assignee_id IS NULL OR assignee_id = <caller>)
AND module_id = <module>   -- only when a module is given

ORDER BY module position, task position, task id
```

A custom Todo column, such as a backlog, therefore holds work that is not ready to be
claimed. A person drags a card into Todo to release it. `next` still takes no other
filter, with `module` as the one exception.

### 4.7 List order

`list` orders by module position, status, column position (locked as 0), task position,
then id.

### 4.8 Access

- `view` reads modules and columns. `edit` changes them. Non-members get 403, as with
  tasks.
- A module or column id resolves to its project first, and the check runs on that
  project. A `module_id` or `column_id` in a request body must belong to the task's
  project.
- Permissions stay per project. A member sees every module of a project they can see.

### 4.9 Validation

| Field | Rule |
|---|---|
| Module name | Required, 1 to 50 characters after trimming, unique within the project ignoring case |
| Column name | The same limits, unique within the module ignoring case. `Todo`, `Doing`, `Review` and `Done` are reserved, ignoring case |
| Column status | One of the four statuses. Fixed after creation |

Uniqueness is compared in `TaskModuleStore` with `toLocaleLowerCase`, so non-Latin case
variants also collide. The unique indexes are the backstop.

## 5. MCP

**No new tools.** The tool count stays at 39. Modules and columns are named, as
`assignee` is.

| Tool | New inputs |
|---|---|
| `add_task` | `module`, `column` |
| `list_tasks` | `module`, which also combines with `next: true` |
| `edit_task` | `module`, `column` (nullable: back to the locked column) |

- **Names** are matched ignoring case. A locked column's name is accepted as a column.
- **Errors list what is valid:** `module 'X' not found. Valid modules: General, Backend`
  and `column 'X' not found in module 'General'. Valid columns: Todo, Backlog, Doing,
  Review, Done`.
- **A conflict** reads: `column 'QA' has status review, not doing`.
- **Results:** the full task and the compact row gain `module` and `column`, both names.
  A locked column reports its built-in name.
- **`url` is unchanged.** The portal finds the task's module itself (section 7.1), so
  old links keep working.

### 5.1 Agent flow

The Core flow works unchanged. With modules:

```text
list_tasks({ project: "docs", module: "Backend", next: true })
add_task({ project: "docs", title: "Fix login", module: "Backend", column: "Backlog" })
edit_task({ task_id: 12, expected_version: 3, column: "QA" })   # status follows the column
```

### 5.2 Catalog

The catalog stands at 39,944 of 40,000 characters, and the new parameters need about 300
to 600. **The budget in `test/mcp-catalog.test.ts` rises to 41,000.** Core's rule was to
trim rather than raise, but the last trim already removed everything that was not needed
to call the tools correctly. The owner approved this exception for this change, and the
new test comment records the reason.

Schema text stays in English. The `next` parameter's description changes to allow
`module`.

## 6. REST API

Routes join `src/web/taskRoutes.ts`.

```text
GET    /api/projects/:id/modules
POST   /api/projects/:id/modules    { name }
PATCH  /api/modules/:id             { name?, move?: "left" | "right" }
DELETE /api/modules/:id
POST   /api/modules/:id/columns     { name, status }
PATCH  /api/columns/:id             { name?, move?: "left" | "right" }
DELETE /api/columns/:id
```

`GET .../modules` returns:

```json
{
  "can_edit": true,
  "modules": [
    {
      "id": 3,
      "name": "General",
      "position": 1,
      "task_count": 12,
      "columns": [{ "id": 7, "name": "Backlog", "status": "todo", "position": -1 }]
    }
  ]
}
```

- `task_count` includes archived tasks, because it drives the delete guard.
- `columns` holds custom columns only. The client adds the locked ones.
- A `PATCH` with neither `name` nor `move` is a validation error.

Existing routes gain:

| Route | New fields |
|---|---|
| `GET /api/projects/:id/tasks` | `?module_id=` |
| `POST /api/projects/:id/tasks` | `module_id`, `column_id` |
| `PATCH /api/tasks/:id` | `module_id`, `column_id` (nullable) |
| `POST /api/tasks/:id/move` | `module_id`, `column_id` (nullable) |

Task rows gain `module_id`, `module`, `column_id` and `column`. On `move`, an absent
`column_id` follows section 4.3, so a caller that only knows statuses keeps working.
The board always sends it.

| Status | Meaning |
|---|---|
| 400 | Blank or reserved name, status disagreeing with the column, a body id that does not exist or belongs to another project or module |
| 403 | No access |
| 404 | The module or column in the path does not exist |
| 409 | Duplicate name, deleting a module that has tasks or is the last |

## 7. Web UI

```text
[Calendar] [Board] [List]                          filters
[General] [Backend•] [Frontend] [+]         ⋯ menu of Backend
┌🔒TODO 3──┐┌Backlog 5─┐┌🔒DOING 2─┐┌QA 1─────┐┌🔒REVIEW┐┌🔒DONE┐ [+ Add column]
│          ││ Todo   ⋯ ││          ││Review  ⋯││        ││      │
```

### 7.1 URL

```text
/?calendar=<project_id>&view=board&module=<id>&task=<id>
```

- `module` is kept when switching tabs, and `withoutCalendar` removes it.
- A missing or unknown `module` falls back without an error: the Board uses the project's
  first module, and List and Calendar use `All`.
- **A task link with no `module` opens the Board on that task's module**, so links from
  MCP and the activity log land in the right place. Closing the modal writes that module
  into the URL, so the Board does not jump away. A task not in the loaded rows, such as an
  archived one, falls back to the first module.

### 7.2 Module bar

- Sits below the tabs on all three tabs. It shows even with only `General`, so `+` can
  be reached.
- The Board shows one module. List and Calendar also offer `All`, their default.
- `+` opens an inline name field.
- The selected module's `⋯` menu has Rename (inline field), Move left, Move right and
  Delete. Delete is disabled, with the reason, when the module has tasks or is the last.
- If someone else deletes the open module, the view falls back as in 7.1.

### 7.3 Column headers

| Column | Name | Other |
|---|---|---|
| Todo | `--blue-text`, uppercase | Lock icon, no menu |
| Doing | `--amber-text`, uppercase | Lock icon, no menu |
| Review | `--purple-text`, uppercase | Lock icon, no menu |
| Done | `--green-text`, uppercase | Lock icon, no menu |
| Custom | `--text`, as typed | Status in small `--text-3` text, `⋯` menu |

- The icon is an inline SVG with the title `Built-in column: cannot be renamed or deleted`,
  so colour is never the only signal.
- All colours are existing tokens with light and dark values.

### 7.4 Managing columns

- `+ Add column` ends the row and opens an inline form for a name and a status. The column
  appears last in that status.
- The `⋯` menu has Rename, Move left, Move right and Delete.
- Deleting a column that has cards asks first, with `window.confirm`, naming the number of
  cards and the destination column.
- A failed change shows the server's message in a toast, as task moves do.
- The board scrolls horizontally. Column widths stay at a minimum of 230px, so the grid
  must stop assuming four columns.
- Without `can_edit`, none of these controls appear.

### 7.5 Cards

- Dragging works across all columns of the open module. The drop sends `status`,
  `column_id` and `before_id`.
- Every column of status `done` shows 20 cards first with `Show more`, and a drop on empty
  space goes to its top, as Done does today.
- Quick add appears in every column of status `todo`, and adds to that column.
- A card with a `column_id` the client does not know yet shows in the locked column of its
  status until the module list refreshes. No card disappears.

### 7.6 Task modal

- The `Status` field becomes one **Column** field: `Todo`, `Backlog (Todo)`, `Doing`,
  `QA (Review)`, and so on, in board order. Choosing one sets both column and status, so the
  two cannot disagree.
- A new **Module** field lists the project's modules. Changing it resets Column to the locked
  column of the current status.
- If the selected custom column is deleted while the modal is open, the field falls back to
  the locked column of its status.
- Without `can_edit`, both are read-only.

### 7.7 Other views

- **List** gains a `Column` column, and a `Module` column when `All` is selected. The `Status`
  column stays.
- **Calendar** filters tasks by the selected module. Page activity is not filtered.
- Assignee and label filters still offer the whole project's values.
- The sidebar's calendar icon still counts the whole project.

## 8. Changes to existing systems

### 8.1 Activity log

New targets `board_module` and `board_column`, with existing actions `add`, `edit` (a rename)
and `delete`. They set `project_id`, leave `knowledge_id` NULL, and hold the name in
`task_title`. Existing visibility already matches on `project_id`.

- A rename stores `Old → New`.
- Deleting a column with cards is one row, such as `QA (3 cards moved to Review)`.
- Move left or right is not logged.
- `ActivityLogModal.describeTarget` gains both cases. They are not jumpable.

### 8.2 Live updates

Add `{ type: "board-changed"; project_id: number }`, emitted after commit by
`TaskModuleStore` on every structural change, except the silent default module in 4.1.

- A new `Modules` tag, by project, joins `REFRESH_TAGS`.
- `board-changed` invalidates `Modules` and `Tasks` of that project, plus the activity log,
  because deleting a column moves cards.
- `task-changed` also invalidates `Modules` of that project, because `task_count` drives
  the delete guard.

### 8.3 Not changed

- **nginx:** no new streaming endpoint.
- **Share routes and `pages_fts`:** untouched.
- **Asset GC:** names hold no assets.
- **`openTaskSummaries`:** counts per project.

## 9. Testing

| File | What it proves |
|---|---|
| `test/task-modules.test.ts` (new) | CRUD, default `General`, reserved and duplicate names including non-Latin case, move ordering across the locked column, move past an edge, delete guards, deleting a column keeps card order and bumps no version, a project with only an empty `General` can be unregistered |
| `test/tasks.test.ts` | Every row of the 4.3 table, status conflicts, columns from another module, version rules in 4.4, position per column, `next` skipping custom Todo columns and following module order, archived tasks keeping placement |
| `test/tasks-tools.test.ts` | `module` and `column` on each tool, errors listing valid names, `next` with `module`, other filters with `next` still refused, the Core agent flow unchanged |
| `test/tasks-web.test.ts` | Routes and status codes, `view` cannot change structure, non-members refused by module and column id, body ids from another project refused |
| `test/db-migration.test.ts` | An older database with tasks gains `General` with order intact, a second open changes nothing, a task with no module or a mismatched column is repaired on the next open |
| `test/task-board.test.ts` | Column order, drop resolution and `applyMove` per column, Done rules on custom columns, a card with an unknown column |
| `test/calendar.test.ts` | `module` round-trips, `withoutCalendar` removes it, old URLs parse as before |
| `test/activity-log-tasks.test.ts` | Members see structure rows of their projects only |
| `test/mcp-catalog.test.ts` | The catalog stays under the new budget |

Then on the dev instance: the agent flow over real MCP with modules, a column and a module
appearing in a second tab without a reload, and the owner's check of both themes, dragging
and the modal in a real browser.

## 10. Documentation and release

- `client/src/components/HelpModal.tsx`, EN and TH tabs.
- Tutorial `&4`, updated through production's MCP after the deploy.
- `docs/skill/SKILL.md` and the global copy.
- `README.md`, and `AGENTS.md` for the repo layout. The tool count does not change.
- The comments in `src/store/tasks.ts` and `schema.sql` that describe position as per status.
- **Exception:** the showcase `&3` is skipped, for the reason given in Core.

Release as `v0.34.0` with a GitHub Release once `npm run typecheck` and `npm test` pass. Its
notes also cover the green calendar icon, which landed after `v0.33.0`. Deploying to production
is a separate step, confirmed by the owner.

## 11. Known limits

- Modules and columns are reordered from a menu, not by dragging. Dragging columns and cards in
  one `DndContext` conflicts easily, and the menu works from the keyboard. Dragging can be added
  later.
- Cards cannot be dragged between modules. The modal moves them.
- Columns have no colour picker and no work-in-progress limit.
- Agents cannot create or change modules or columns.
- `list_tasks` filters by module and status, not by column.
- Permissions cannot differ between modules of one project.
- `GET .../tasks` still returns every module's non-archived tasks, and the client selects from
  them, so the Board, List and Calendar share one query.
