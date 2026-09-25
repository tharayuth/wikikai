import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import type { ToolHandlers } from "../src/mcp/handlers.js";

// The tools/list response is what every MCP client loads, usually once per
// session, so its size is a cost paid over and over. These tests keep it from
// quietly growing back.

async function listTools() {
  const handlers = new Proxy({}, { get: () => async () => ({}) }) as ToolHandlers;
  const server = createMcpServer(handlers);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "catalog-test", version: "0" });
  await client.connect(b);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

describe("MCP tool catalog", () => {
  it("stays within its size budget", async () => {
    const size = JSON.stringify(await listTools()).length;
    // ≈ 4 characters per token. Raising the budget needs a reason: every
    // client pays for it at the start of every session.
    expect(size, `catalog is ${size} chars`).toBeLessThan(40_000);
  });

  it("gives every tool a description", async () => {
    for (const t of await listTools()) {
      expect(t.description?.length, t.name).toBeGreaterThan(20);
    }
  });

  it("sends real line breaks, not escaped ones", async () => {
    for (const t of await listTools()) {
      expect(t.description, t.name).not.toContain("\\n");
    }
  });

  it("does not expose internal-only fields", async () => {
    const tools = await listTools();
    for (const name of ["add_image", "add_file"]) {
      const schema = tools.find((t) => t.name === name)!.inputSchema;
      expect(Object.keys(schema.properties ?? {}), name).not.toContain("data_base64");
      expect(schema.required, name).toContain("path");
    }
  });
});
