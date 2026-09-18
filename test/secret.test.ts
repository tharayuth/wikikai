import { describe, expect, it } from "vitest";
import {
  SECRET_ITERATIONS,
  formatSecretFence,
  parseSecretEnvelope,
  sealSecret,
  unsealSecret,
} from "../src/lib/secret.js";

describe("secret envelope (AES-256-GCM + PBKDF2)", () => {
  it("round-trips unicode text under the same key", async () => {
    const env = await sealSecret("pass: สวัสดี🔑 #1", "hunter2", { label: "db" });
    expect(await unsealSecret(env, "hunter2")).toBe("pass: สวัสดี🔑 #1");
  });

  it("produces a v1 envelope with fresh base64 salt / iv per call", async () => {
    const a = await sealSecret("plaintext-marker-zzz", "k");
    const b = await sealSecret("plaintext-marker-zzz", "k");
    expect(a.v).toBe(1);
    expect(a.iter).toBe(SECRET_ITERATIONS);
    expect(a.salt).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a.iv).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a.ct).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(JSON.stringify(a)).not.toContain("plaintext-marker");
  });

  it("keeps label + hint in the clear, omits them when absent", async () => {
    const env = await sealSecret("s", "k", { label: "prod DB", hint: "usual one" });
    expect(env.label).toBe("prod DB");
    expect(env.hint).toBe("usual one");
    const bare = await sealSecret("s", "k");
    expect("label" in bare).toBe(false);
    expect("hint" in bare).toBe(false);
  });

  it("rejects a wrong key", async () => {
    const env = await sealSecret("top", "right");
    await expect(unsealSecret(env, "wrong")).rejects.toThrow(/wrong key|tampered/i);
  });

  it("rejects a tampered ciphertext", async () => {
    const env = await sealSecret("top", "k");
    const bytes = Buffer.from(env.ct, "base64");
    bytes[0] ^= 0xff;
    await expect(unsealSecret({ ...env, ct: bytes.toString("base64") }, "k")).rejects.toThrow(
      /wrong key|tampered/i,
    );
  });

  it("parses a fence body and rejects malformed ones", async () => {
    const env = await sealSecret("s", "k", { label: "L" });
    expect(parseSecretEnvelope(JSON.stringify(env))).toEqual(env);
    expect(() => parseSecretEnvelope("not json")).toThrow(/json/i);
    expect(() => parseSecretEnvelope(JSON.stringify({ v: 2, salt: "a", iv: "b", ct: "c" }))).toThrow(
      /version/i,
    );
    expect(() => parseSecretEnvelope(JSON.stringify({ v: 1, salt: "a", iv: "b" }))).toThrow(/ct/);
    expect(() => parseSecretEnvelope(JSON.stringify({ v: 1, salt: "a", iv: "b", ct: "!!" }))).toThrow(
      /base64/i,
    );
  });

  it("formats a ready-to-paste ```secret fence", async () => {
    const env = await sealSecret("s", "k", { label: "L" });
    const fence = formatSecretFence(env);
    expect(fence.startsWith("```secret\n")).toBe(true);
    expect(fence.endsWith("\n```")).toBe(true);
    expect(parseSecretEnvelope(fence.split("\n")[1])).toEqual(env);
  });
});
