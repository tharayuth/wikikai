import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { assertProjectAccess, type AccessLevel } from "../lib/permissions.js";
import type { PermissionStore } from "../store/permissions.js";
import {
  NOTE_STATES,
  NoteConflictError,
  NoteNotFoundError,
  NoteStaleError,
  type NoteState,
  type NoteStore,
} from "../store/notes.js";

export interface NoteRouteOptions {
  notes: NoteStore;
  permissions: PermissionStore;
  aclEnabled: boolean;
}

// Shapes only. Limits and meaning are enforced by NoteStore.
const ItemBody = z.object({
  id: z.number().int().positive().optional(),
  text: z.string(),
  checked: z.boolean(),
});

const AddBody = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  items: z.array(ItemBody).nullable().optional(),
  color: z.string().optional(),
  labels: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
});

const PatchBody = AddBody.extend({
  expected_version: z.number().int().positive().optional(),
  archived: z.boolean().optional(),
  trashed: z.boolean().optional(),
});

const ToggleBody = z.object({ checked: z.boolean() });
const MoveBody = z.object({ before_id: z.number().int().positive().nullable() });

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error("invalid id");
  return n;
}

function parseState(raw: unknown): NoteState {
  if (raw === undefined) return "active";
  if ((NOTE_STATES as readonly unknown[]).includes(raw)) return raw as NoteState;
  throw new Error(`state must be one of: ${NOTE_STATES.join(", ")}`);
}

export function attachNoteRoutes(app: Express, opts: NoteRouteOptions): void {
  const { notes, permissions, aclEnabled } = opts;

  const gate = (req: Request, project: string, need: AccessLevel): void => {
    if (!req.user || !aclEnabled || req.user.is_admin) return;
    assertProjectAccess(req.user, project, need, permissions, { enabled: aclEnabled });
  };

  const canEdit = (req: Request, project: string): boolean => {
    if (!req.user || !aclEnabled || req.user.is_admin) return true;
    return permissions.get(req.user.id, project)?.level === "edit";
  };

  /** The note's project name, for the access check. Throws when it is gone. */
  const projectOfNote = (id: number): string => {
    const note = notes.get(id);
    if (!note) throw new NoteNotFoundError(`note ${id}`);
    return notes.getProject(note.project_id)?.name ?? "";
  };

  const fail = (e: unknown, res: Response, next: NextFunction): void => {
    if (e instanceof NoteStaleError) {
      res.status(409).json({ error: e.message, current_version: e.currentVersion });
    } else if (e instanceof NoteConflictError) {
      res.status(409).json({ error: e.message });
    } else if (e instanceof NoteNotFoundError) {
      res.status(404).json({ error: e.message });
    } else {
      next(e);
    }
  };

  app.get("/api/projects/:id/notes", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const project = notes.getProject(id);
      if (!project) {
        res.status(404).json({ error: `project ${id} not found` });
        return;
      }
      gate(req, project.name, "view");
      res.json({ can_edit: canEdit(req, project.name), notes: notes.list(id, parseState(req.query.state)) });
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.post("/api/projects/:id/notes", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const project = notes.getProject(id);
      if (!project) {
        res.status(404).json({ error: `project ${id} not found` });
        return;
      }
      gate(req, project.name, "edit");
      res.status(201).json(notes.add(id, AddBody.parse(req.body)));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.get("/api/notes/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const project = projectOfNote(id);
      gate(req, project, "view");
      res.json({ can_edit: canEdit(req, project), note: notes.get(id) });
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.patch("/api/notes/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfNote(id), "edit");
      res.json(notes.edit(id, PatchBody.parse(req.body)));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.post("/api/notes/:id/items/:itemId", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfNote(id), "edit");
      res.json(notes.toggleItem(id, parseId(req.params.itemId), ToggleBody.parse(req.body).checked));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.post("/api/notes/:id/move", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfNote(id), "edit");
      res.json(notes.move(id, MoveBody.parse(req.body).before_id));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.delete("/api/notes/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfNote(id), "edit");
      notes.remove(id);
      res.json({ deleted: true });
    } catch (e) {
      fail(e, res, next);
    }
  });
}
