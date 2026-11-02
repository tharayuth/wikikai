import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { KnowledgeStore } from "../src/store/knowledge.js";

function setup() {
  const db = openDb(":memory:");
  const knowledge = new KnowledgeStore(db);
  knowledge.registerProject("alpha");
  knowledge.registerProject("beta");
  const log = new ActivityLogStore(db);
  const idOf = (name: string): number =>
    (db.prepare("SELECT id FROM projects WHERE name = ?").get(name) as { id: number }).id;
  return { knowledge, log, alpha: idOf("alpha"), beta: idOf("beta") };
}

describe("activity log: board_task rows", () => {
  it("stores the project, task id and title", () => {
    const { log, alpha } = setup();
    log.record({
      action: "add",
      target: "board_task",
      project_id: alpha,
      task_id: 12,
      task_title: "Ship it",
    });
    expect(log.list().entries[0]).toMatchObject({
      action: "add",
      target: "board_task",
      knowledge_id: null,
      project_id: alpha,
      task_id: 12,
      task_title: "Ship it",
    });
  });

  it("shows a member the task rows of their projects only", () => {
    const { log, alpha, beta } = setup();
    log.record({ action: "add", target: "board_task", project_id: alpha, task_id: 1, task_title: "A" });
    log.record({ action: "add", target: "board_task", project_id: beta, task_id: 2, task_title: "B" });
    const { entries, total } = log.list({ visibleProjects: ["alpha"] });
    expect(entries.map((e) => e.task_id)).toEqual([1]);
    expect(total).toBe(1);
  });

  it("keeps showing a member the document rows of their projects", () => {
    const { knowledge, log } = setup();
    const k = knowledge.add({ title: "Doc", project: "alpha" });
    log.record({ action: "add", target: "knowledge", knowledge_id: k.id, knowledge_title: "Doc" });
    expect(log.list({ visibleProjects: ["alpha"] }).entries).toHaveLength(1);
    expect(log.list({ visibleProjects: ["beta"] }).entries).toHaveLength(0);
  });

  it("still hides rows with neither a document nor a project from members", () => {
    const { log } = setup();
    log.record({ action: "upload", target: "image" });
    expect(log.list({ visibleProjects: ["alpha"] }).entries).toEqual([]);
    expect(log.list({ visibleProjects: null }).entries).toHaveLength(1);
  });

  it("leaves task rows off the page calendar", () => {
    const { log, alpha } = setup();
    log.record({ action: "add", target: "board_task", project_id: alpha, task_id: 1, task_title: "A" });
    const today = new Date().toISOString().slice(0, 10);
    expect(log.calendar({ project: "alpha", from: today, to: today, tz: "UTC" })).toEqual([]);
  });
});

describe("activity log: board structure rows", () => {
  it("shows a member the structure rows of their projects only", () => {
    const { log, alpha, beta } = setup();
    log.record({ action: "add", target: "board_module", project_id: alpha, task_title: "Backend" });
    log.record({ action: "add", target: "board_column", project_id: beta, task_title: "QA" });
    const { entries } = log.list({ visibleProjects: ["alpha"] });
    expect(entries.map((e) => [e.target, e.task_title])).toEqual([["board_module", "Backend"]]);
  });
});
