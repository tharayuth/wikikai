import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";
import { ImageStore } from "../src/store/images.js";
import { PromptLogStore } from "../src/store/promptLog.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { PermissionStore } from "../src/store/permissions.js";
import { UserStore } from "../src/store/users.js";
import { buildToolHandlers, type HandlerContext } from "../src/mcp/handlers.js";
import { withCallContext } from "../src/lib/callContext.js";
import { parseSecretEnvelope } from "../src/lib/secret.js";

describe("seal_secret + reveal_secret", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  let knowledge: KnowledgeStore;
  let pages: PageStore;
  let users: UserStore;
  let permissions: PermissionStore;

  const build = (ctx: Partial<HandlerContext> = {}) =>
    buildToolHandlers(
      knowledge,
      pages,
      new ImageStore(db, path.join(dir, "images")),
      new PromptLogStore(db),
      new ActivityLogStore(db),
      { publicBaseUrl: "http://test", ...ctx },
      permissions,
      users,
      db,
    );

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-secret-tool-"));
    db = openDb(":memory:");
    knowledge = new KnowledgeStore(db);
    pages = new PageStore(db, path.join(dir, "items"));
    users = new UserStore(db);
    permissions = new PermissionStore(db);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("seal_secret returns a paste-ready fence and never echoes the text", async () => {
    const h = build();
    const r = await h.seal_secret({ text: "p@ss-marker", label: "prod DB", hint: "vault", key: "k1" });
    expect(r.fence.startsWith("```secret\n")).toBe(true);
    expect(r.fence).not.toContain("p@ss-marker");
    expect(r.key_source).toBe("argument");
    const env = parseSecretEnvelope(r.fence.split("\n")[1]);
    expect(env.label).toBe("prod DB");
    expect(env.hint).toBe("vault");
  });

  it("seal_secret without a key uses WIKIKAI_SECRET_KEY, else refuses", async () => {
    await expect(build().seal_secret({ text: "x" })).rejects.toThrow(/WIKIKAI_SECRET_KEY/);
    const r = await build({ secretKey: "server-key" }).seal_secret({ text: "x", label: "L" });
    expect(r.key_source).toBe("server");
  });

  it("reveal_secret by block id decrypts the page's block", async () => {
    const h = build();
    const k = await h.add_knowledge({ title: "Doc", project: "ops" });
    const sealed = await h.seal_secret({ text: "hunter2", label: "ssh", key: "k1" });
    const p = await h.add_page({ knowledge_id: k.id, title: "Creds", content: `# Creds\n\n${sealed.fence}\n` });
    const src = await h.read_page({ page_id: p.id, mode: "full" });
    const blockId = Number(/```secret \{@(\d+)\}/.exec(src.content)![1]);
    const r = await h.reveal_secret({ block_id: blockId, key: "k1" });
    expect(r).toMatchObject({
      text: "hunter2",
      label: "ssh",
      block_id: blockId,
      page_id: p.id,
      knowledge_id: k.id,
      index: 0,
      key_source: "argument",
    });
    expect(r.url).toBe(`http://test/&${k.id}/#${p.id}:3`);
  });

  it("reveal_secret by page id picks the only block, else needs label or index", async () => {
    const h = build({ secretKey: "srv" });
    const k = await h.add_knowledge({ title: "Doc", project: "ops" });
    const one = await h.seal_secret({ text: "only", label: "A" });
    const p1 = await h.add_page({ knowledge_id: k.id, title: "One", content: one.fence });
    expect((await h.reveal_secret({ page_id: p1.id })).text).toBe("only");

    const a = await h.seal_secret({ text: "first", label: "DB" });
    const b = await h.seal_secret({ text: "second", label: "API" });
    const p2 = await h.add_page({ knowledge_id: k.id, title: "Two", content: `${a.fence}\n\n${b.fence}` });
    await expect(h.reveal_secret({ page_id: p2.id })).rejects.toThrow(/2 secrets.*"DB".*"API"/s);
    expect((await h.reveal_secret({ page_id: p2.id, label: "api" })).text).toBe("second");
    expect((await h.reveal_secret({ page_id: p2.id, index: 0 })).text).toBe("first");
    await expect(h.reveal_secret({ page_id: p2.id, label: "nope" })).rejects.toThrow(/no secret labelled "nope"/);
    await expect(h.reveal_secret({ page_id: p2.id, index: 5 })).rejects.toThrow(/index 5/);
  });

  it("reveal_secret reports a wrong key and a page without secrets", async () => {
    const h = build();
    const k = await h.add_knowledge({ title: "Doc", project: "ops" });
    const s = await h.seal_secret({ text: "t", key: "right" });
    const p = await h.add_page({ knowledge_id: k.id, title: "P", content: s.fence });
    await expect(h.reveal_secret({ page_id: p.id, key: "wrong" })).rejects.toThrow(/wrong key/);
    const empty = await h.add_page({ knowledge_id: k.id, title: "E", content: "# nothing" });
    await expect(h.reveal_secret({ page_id: empty.id, key: "x" })).rejects.toThrow(/no secret blocks/);
    await expect(h.reveal_secret({ key: "x" } as never)).rejects.toThrow(/block_id|page_id/);
  });

  it("reveal_secret respects project view permission", async () => {
    const h = build();
    const k = await h.add_knowledge({ title: "Doc", project: "private" });
    const s = await h.seal_secret({ text: "t", key: "k" });
    const p = await h.add_page({ knowledge_id: k.id, title: "P", content: s.fence });
    const bob = users.create({ email: "bob@x.test", password: "pw", display_name: "Bob", is_admin: false });
    await expect(
      withCallContext({ source: "mcp", tool_name: "reveal_secret", user_id: bob.id }, () =>
        h.reveal_secret({ page_id: p.id, key: "k" }),
      ),
    ).rejects.toThrow(/no access to project 'private'/);
  });
});
