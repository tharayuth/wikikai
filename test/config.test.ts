import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config.js";

describe("loadConfig", () => {
  it("defaults to host 0.0.0.0 and port 3939", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3939);
    expect(c.host).toBe("0.0.0.0");
    expect(c.dataDir).toContain("/data");
    expect(c.dbPath).toContain("index.db");
    expect(c.itemsDir).toContain("/items");
  });

  it("auto-builds publicBaseUrl from detected LAN ip when host=0.0.0.0", () => {
    const c = loadConfig({});
    // either a LAN IP (192.x / 10.x / 172.x) or fallback to 127.0.0.1
    expect(c.publicBaseUrl).toMatch(/^http:\/\/(\d+\.\d+\.\d+\.\d+):3939$/);
    expect(c.publicBaseUrl).not.toContain("0.0.0.0");
  });

  it("uses host literally for publicBaseUrl when host is specific", () => {
    const c = loadConfig({ HOST: "127.0.0.1", PORT: "4040" });
    expect(c.publicBaseUrl).toBe("http://127.0.0.1:4040");
  });

  it("honours env overrides", () => {
    const c = loadConfig({
      PORT: "5050",
      HOST: "10.0.0.5",
      DATA_DIR: "/tmp/x",
      DB_PATH: "/tmp/x.db",
      ITEMS_DIR: "/tmp/items",
      PUBLIC_BASE_URL: "https://portal.example.com",
    });
    expect(c.port).toBe(5050);
    expect(c.host).toBe("10.0.0.5");
    expect(c.publicBaseUrl).toBe("https://portal.example.com");
  });
});
