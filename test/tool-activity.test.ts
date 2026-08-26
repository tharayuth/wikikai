import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import {
  TOOL_CALL_TTL_MS,
  emitToolCall,
  getRecentToolCall,
  onEvent,
  type WikikaiEvent,
} from "../src/lib/events.js";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";
import { ImageStore } from "../src/store/images.js";
import { PromptLogStore } from "../src/store/promptLog.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { SessionStore, UserStore } from "../src/store/users.js";
import { PermissionStore } from "../src/store/permissions.js";
import { buildToolHandlers } from "../src/mcp/handlers.js";
import { createMcpServer } from "../src/mcp/server.js";
import { buildApp } from "../src/web/app.js";

describe("tool-call activity signal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcasts a tool-called event to subscribers", () => {
    const seen: WikikaiEvent[] = [];
    const off = onEvent((e) => seen.push(e));
    emitToolCall("read_page");
    off();

    expect(seen).toEqual([
      { type: "tool-called", tool_name: "read_page", age_ms: 0 },
    ]);
  });

  it("does not notify a subscriber that has unsubscribed", () => {
    const seen: WikikaiEvent[] = [];
    const off = onEvent((e) => seen.push(e));
    off();
    emitToolCall("search");

    expect(seen).toEqual([]);
  });

  it("replays the last call with its age while inside the TTL window", () => {
    emitToolCall("get_outline");
    vi.advanceTimersByTime(12_000);

    expect(getRecentToolCall()).toEqual({
      tool_name: "get_outline",
      age_ms: 12_000,
    });
  });

  it("stops replaying once the TTL window has elapsed", () => {
    emitToolCall("get_outline");
    vi.advanceTimersByTime(TOOL_CALL_TTL_MS);

    expect(getRecentToolCall()).toBeNull();
  });

  it("keeps only the newest call and restarts its window", () => {
    emitToolCall("read_page");
    vi.advanceTimersByTime(TOOL_CALL_TTL_MS - 1_000);
    emitToolCall("edit_section");
    vi.advanceTimersByTime(2_000);

    expect(getRecentToolCall()).toEqual({
      tool_name: "edit_section",
      age_ms: 2_000,
    });
  });
});

/** Build the full store + handler stack against a throwaway data dir. */
function makeStack() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wk-toolact-"));
  const db = openDb(":memory:");
  const knowledge = new KnowledgeStore(db);
  const pages = new PageStore(db, tmpDir);
  const images = new ImageStore(db, path.join(tmpDir, "images"));
  const promptLog = new PromptLogStore(db);
  const activityLog = new ActivityLogStore(db);
  const users = new UserStore(db);
  const sessions = new SessionStore(db, users);
  const permissions = new PermissionStore(db);
  const handlers = buildToolHandlers(
    knowledge,
    pages,
    images,
    promptLog,
    activityLog,
    { publicBaseUrl: "http://test" },
    permissions,
    users,
    db,
  );
  const app = buildApp({
    knowledge,
    pages,
    images,
    promptLog,
    activityLog,
    users,
    sessions,
    permissions,
    handlers,
    publicBaseUrl: "http://test",
  });
  return { tmpDir, handlers, app };
}

describe("tool-call activity over MCP + SSE", () => {
  let stack: ReturnType<typeof makeStack>;

  beforeEach(() => {
    stack = makeStack();
  });

  afterEach(() => {
    fs.rmSync(stack.tmpDir, { recursive: true, force: true });
  });

  it("emits a tool-called event when a client invokes an MCP tool", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import(
      "@modelcontextprotocol/sdk/inMemory.js"
    );

    const server = createMcpServer(stack.handlers);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const seen: WikikaiEvent[] = [];
    const off = onEvent((e) => {
      if (e.type === "tool-called") seen.push(e);
    });
    await client.callTool({ name: "list_knowledge", arguments: {} });
    off();
    await client.close();

    expect(seen).toEqual([
      { type: "tool-called", tool_name: "list_knowledge", age_ms: 0 },
    ]);
  });

  it("replays the recent tool call to a newly connected SSE client", async () => {
    const server = stack.app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as AddressInfo;

    emitToolCall("read_page");

    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    ac.abort();
    await new Promise((r) => server.close(r));

    const line = chunk.split("\n").find((l) => l.startsWith("data: "));
    expect(line).toBeDefined();
    const event = JSON.parse(line!.slice("data: ".length));
    expect(event.type).toBe("tool-called");
    expect(event.tool_name).toBe("read_page");
    expect(event.age_ms).toBeGreaterThanOrEqual(0);
    expect(event.age_ms).toBeLessThan(TOOL_CALL_TTL_MS);
  });
});
