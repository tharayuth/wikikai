import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { ShareUserStore } from "../src/store/shareUsers.js";
import { signShareCookie, verifyShareCookie } from "../src/lib/shareCookie.js";

describe("ShareUserStore", () => {
  let knowledge: KnowledgeStore;
  let store: ShareUserStore;
  let kid: number;

  beforeEach(() => {
    const db = openDb(":memory:");
    knowledge = new KnowledgeStore(db);
    store = new ShareUserStore(db);
    kid = knowledge.add({ title: "Doc", project: "examples" }).id;
  });

  it("adds a user with no expiry and lists it without the hash", () => {
    const u = store.add({ knowledge_id: kid, username: "reader", password: "pw123" });
    expect(u.username).toBe("reader");
    expect(u.expires_at).toBeNull();
    const list = store.list(kid);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toMatch(/password_hash|scrypt/);
  });

  it("computes expires_at from a day count (whole days from now)", () => {
    const before = Date.now();
    const u = store.add({
      knowledge_id: kid,
      username: "temp",
      password: "pw",
      expires_in_days: 7,
    });
    const exp = new Date(u.expires_at as string).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + 7 * 86_400_000 - 1000);
    expect(exp).toBeLessThanOrEqual(before + 7 * 86_400_000 + 5000);
  });

  it("rejects duplicate usernames within one knowledge but not across", () => {
    store.add({ knowledge_id: kid, username: "a", password: "x" });
    expect(() =>
      store.add({ knowledge_id: kid, username: "a", password: "y" }),
    ).toThrow(/already exists/);
    const other = knowledge.add({ title: "Other", project: "examples" }).id;
    expect(() =>
      store.add({ knowledge_id: other, username: "a", password: "y" }),
    ).not.toThrow();
  });

  it("validates inputs", () => {
    expect(() =>
      store.add({ knowledge_id: kid, username: "", password: "x" }),
    ).toThrow(/username/);
    expect(() =>
      store.add({ knowledge_id: kid, username: "ok", password: "" }),
    ).toThrow(/password/);
    expect(() =>
      store.add({ knowledge_id: kid, username: "ok", password: "x", expires_in_days: 0 }),
    ).toThrow(/expires_in_days/);
    expect(() =>
      store.add({ knowledge_id: kid, username: "ok", password: "x", expires_in_days: 1.5 }),
    ).toThrow(/expires_in_days/);
  });

  it("verifies credentials: ok / invalid / expired", () => {
    store.add({ knowledge_id: kid, username: "reader", password: "secret" });
    expect(store.verify(kid, "reader", "secret")?.username).toBe("reader");
    expect(store.verify(kid, "reader", "wrong")).toBeNull();
    expect(store.verify(kid, "nobody", "secret")).toBeNull();
    // Same username on another knowledge must not unlock this one.
    const other = knowledge.add({ title: "Other", project: "examples" }).id;
    store.add({ knowledge_id: other, username: "x", password: "y" });
    expect(store.verify(kid, "x", "y")).toBeNull();
  });

  it("reports an expired user distinctly", () => {
    const u = store.add({ knowledge_id: kid, username: "old", password: "pw", expires_in_days: 1 });
    store.setExpiresAtForTest(u.id, new Date(Date.now() - 1000).toISOString());
    expect(store.verify(kid, "old", "pw")).toBe("expired");
    expect(store.list(kid)[0].expired).toBe(true);
  });

  it("removes a user, scoped to its knowledge", () => {
    const u = store.add({ knowledge_id: kid, username: "r", password: "p" });
    const other = knowledge.add({ title: "Other", project: "examples" }).id;
    expect(store.remove(other, u.id)).toBe(false);
    expect(store.remove(kid, u.id)).toBe(true);
    expect(store.list(kid)).toHaveLength(0);
  });

  it("cascades when the knowledge is deleted", () => {
    store.add({ knowledge_id: kid, username: "r", password: "p" });
    knowledge.remove(kid);
    expect(store.list(kid)).toHaveLength(0);
  });

  it("tracks the protected flag on the knowledge", () => {
    expect(knowledge.isShareProtected(kid)).toBe(false);
    knowledge.setShareProtected(kid, true);
    expect(knowledge.isShareProtected(kid)).toBe(true);
    knowledge.setShareProtected(kid, false);
    expect(knowledge.isShareProtected(kid)).toBe(false);
  });
});

describe("share cookie", () => {
  it("round-trips and rejects tampering / other keys / expiry", () => {
    const exp = Date.now() + 60_000;
    const c = signShareCookie(42, exp, "scrypt$salt$hash");
    expect(verifyShareCookie(c, "scrypt$salt$hash")).toEqual({ userId: 42, exp });
    expect(verifyShareCookie(c, "scrypt$salt$other")).toBeNull();
    expect(verifyShareCookie(c.replace(/^42/, "43"), "scrypt$salt$hash")).toBeNull();
    const stale = signShareCookie(42, Date.now() - 1, "scrypt$salt$hash");
    expect(verifyShareCookie(stale, "scrypt$salt$hash")).toBeNull();
    expect(verifyShareCookie("garbage", "scrypt$salt$hash")).toBeNull();
  });
});
