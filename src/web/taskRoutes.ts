import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ForbiddenError, assertProjectAccess, type AccessLevel } from "../lib/permissions.js";
import { renderMarkdown } from "../render/markdown.js";
import type { PermissionStore } from "../store/permissions.js";
import {
  BoardItemNotFoundError,
  TASK_STATUSES,
  TaskConflictError,
  TaskNotFoundError,
  TaskStaleError,
  type TaskProject,
  type TaskStore,
} from "../store/tasks.js";

export interface TaskRouteOptions {
  tasks: TaskStore;
  permissions: PermissionStore;
  aclEnabled: boolean;
}

// Shapes only. Limits and meaning are enforced by TaskStore, the one place
// that holds the rules for both REST and MCP.
const LinkBody = z.object({ url: z.string(), label: z.string().optional() });

const AddBody = z.object({
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assignee_id: z.number().int().positive().nullable().optional(),
  start_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  links: z.array(LinkBody).optional(),
  session_id: z.string().nullable().optional(),
  blocked_reason: z.string().nullable().optional(),
  position: z.enum(["top", "bottom"]).optional(),
  module_id: z.number().int().positive().optional(),
  column_id: z.number().int().positive().nullable().optional(),
});

const PatchBody = AddBody.omit({ links: true })
  .partial({ title: true })
  .extend({
    expected_version: z.number().int().positive(),
    add_links: z.array(LinkBody).optional(),
    remove_link_ids: z.array(z.number().int().positive()).optional(),
    archived: z.boolean().optional(),
  });

const MoveBody = z.object({
  status: z.enum(TASK_STATUSES),
  before_id: z.number().int().positive().nullable(),
  expected_version: z.number().int().positive(),
  module_id: z.number().int().positive().optional(),
  column_id: z.number().int().positive().nullable().optional(),
});

const ModuleBody = z.object({ name: z.string() });
const ColumnBody = z.object({ name: z.string(), status: z.enum(TASK_STATUSES) });

const BoardItemPatch = z
  .object({ name: z.string().optional(), move: z.enum(["left", "right"]).optional() })
  .refine((v) => v.name !== undefined || v.move !== undefined, { message: "name or move is required" });

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error("invalid id");
  return n;
}

export function attachTaskRoutes(app: Express, opts: TaskRouteOptions): void {
  const { tasks, permissions, aclEnabled } = opts;

  const gate = (req: Request, project: string, need: AccessLevel): void => {
    if (!req.user || !aclEnabled || req.user.is_admin) return;
    assertProjectAccess(req.user, project, need, permissions, { enabled: aclEnabled });
  };

  const canEdit = (req: Request, project: string): boolean => {
    if (!req.user || !aclEnabled || req.user.is_admin) return true;
    return permissions.get(req.user.id, project)?.level === "edit";
  };

  /** The project in `:id`, or null after answering 404. */
  const loadProject = (req: Request, res: Response): TaskProject | null => {
    const id = parseId(req.params.id);
    const project = tasks.getProject(id);
    if (!project) res.status(404).json({ error: `project ${id} not found` });
    return project;
  };

  /** The task's project name, for the access check. Throws when it is gone. */
  const projectOfTask = (id: number): string => {
    const task = tasks.get(id);
    if (!task) throw new TaskNotFoundError(id);
    return task.project;
  };

  /** The module's project, for the access check. Throws when it is gone. */
  const projectOfModule = (id: number): string => {
    const module = tasks.modules.getModule(id);
    if (!module) throw new BoardItemNotFoundError("module", id);
    return tasks.getProject(module.project_id)?.name ?? "";
  };

  const projectOfColumn = (id: number): string => {
    const column = tasks.modules.getColumn(id);
    if (!column) throw new BoardItemNotFoundError("column", id);
    return projectOfModule(column.module_id);
  };

  const fail = (e: unknown, res: Response, next: NextFunction): void => {
    if (e instanceof TaskStaleError) {
      res.status(409).json({ error: e.message, current_version: e.currentVersion });
    } else if (e instanceof TaskConflictError) {
      res.status(409).json({ error: e.message });
    } else if (e instanceof TaskNotFoundError || e instanceof BoardItemNotFoundError) {
      res.status(404).json({ error: e.message });
    } else {
      next(e);
    }
  };

  app.get("/api/projects/:id/tasks", (req, res, next) => {
    try {
      const project = loadProject(req, res);
      if (!project) return;
      gate(req, project.name, "view");
      res.json({
        project,
        can_edit: canEdit(req, project.name),
        tasks: tasks.list(project.id, {
          includeArchived: req.query.include_archived === "1",
          ...(req.query.module_id ? { moduleId: parseId(String(req.query.module_id)) } : {}),
        }),
      });
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.post("/api/projects/:id/tasks", (req, res, next) => {
    try {
      const project = loadProject(req, res);
      if (!project) return;
      gate(req, project.name, "edit");
      res.status(201).json(tasks.add(project.id, AddBody.parse(req.body)));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.get("/api/projects/:id/members", (req, res, next) => {
    try {
      const project = loadProject(req, res);
      if (!project) return;
      gate(req, project.name, "view");
      res.json({ members: tasks.listMembers(project.name) });
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.get("/api/projects/:id/modules", (req, res, next) => {
    try {
      const project = loadProject(req, res);
      if (!project) return;
      gate(req, project.name, "view");
      res.json({ can_edit: canEdit(req, project.name), modules: tasks.modules.list(project.id) });
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.post("/api/projects/:id/modules", (req, res, next) => {
    try {
      const project = loadProject(req, res);
      if (!project) return;
      gate(req, project.name, "edit");
      res.status(201).json(tasks.modules.addModule(project.id, ModuleBody.parse(req.body).name));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.patch("/api/modules/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfModule(id), "edit");
      res.json(tasks.modules.updateModule(id, BoardItemPatch.parse(req.body)));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.delete("/api/modules/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfModule(id), "edit");
      tasks.modules.deleteModule(id);
      res.json({ deleted: true });
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.post("/api/modules/:id/columns", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfModule(id), "edit");
      res.status(201).json(tasks.modules.addColumn(id, ColumnBody.parse(req.body)));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.patch("/api/columns/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfColumn(id), "edit");
      res.json(tasks.modules.updateColumn(id, BoardItemPatch.parse(req.body)));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.delete("/api/columns/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfColumn(id), "edit");
      tasks.modules.deleteColumn(id);
      res.json({ deleted: true });
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.get("/api/tasks/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfTask(id), "view");
      res.json(tasks.get(id));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.get("/api/tasks/:id/rendered", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfTask(id), "view");
      const html = await renderMarkdown(tasks.get(id)?.description ?? "");
      // Same header as sendPageHtml in app.ts: a proxy must not rewrite the body.
      res.set("Cache-Control", "no-transform").type("text/html").send(html);
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.patch("/api/tasks/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfTask(id), "edit");
      res.json(tasks.edit(id, PatchBody.parse(req.body)));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.post("/api/tasks/:id/move", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfTask(id), "edit");
      res.json(tasks.move(id, MoveBody.parse(req.body)));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.delete("/api/tasks/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (aclEnabled && req.user && !req.user.is_admin) throw new ForbiddenError("admin only");
      tasks.remove(id);
      res.json({ deleted: true });
    } catch (e) {
      fail(e, res, next);
    }
  });
}
