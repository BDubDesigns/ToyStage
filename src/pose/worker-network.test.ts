import { describe, expect, it, vi } from "vitest";
import { restrictWorkerNetwork } from "./worker-network";

describe("worker local-only asset policy", () => {
  function setup() {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("asset"));
    const scope = { location: { href: "https://toy.test/assets/worker.js", origin: "https://toy.test" }, fetch };
    const count = restrictWorkerNetwork(scope);
    return { scope, fetch, count };
  }
  it("permits same-origin GETs and disallows redirects", async () => {
    const { scope, fetch, count } = setup();
    await scope.fetch("/pose/model.task");
    await scope.fetch(new Request("https://toy.test/movenet/model.json"));
    expect(fetch).toHaveBeenCalledWith("/pose/model.task", { redirect: "error" });
    expect(count()).toBe(0);
  });
  it.each([
    ["https://odml.pa.googleapis.com/v1/log", "POST"],
    ["https://cdn.example/model.json", "GET"],
    ["https://toy.test/upload", "POST"],
    ["https://toy.test/asset", "PUT"],
    ["https://toy.test.attacker.example/asset", "GET"],
  ])("blocks %s %s without touching the native network", async (url, method) => {
    const { scope, fetch, count } = setup();
    await expect(scope.fetch(url, { method })).rejects.toThrow("same-origin asset GETs only");
    expect(fetch).not.toHaveBeenCalled(); expect(count()).toBe(1);
  });
  it("honors Request methods and explicit overrides", async () => {
    const { scope, fetch, count } = setup();
    await expect(scope.fetch(new Request("https://toy.test/asset", { method: "POST" }))).rejects.toThrow();
    await expect(scope.fetch(new Request("https://toy.test/asset"), { method: "POST" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled(); expect(count()).toBe(2);
  });
  it("restricts XHR asset loads too", () => {
    const open = vi.fn();
    class Xhr { open() { open(); } }
    Xhr.prototype.open = open;
    const scope = { location: { href: "https://toy.test/assets/worker.js", origin: "https://toy.test" },
      fetch: vi.fn<typeof globalThis.fetch>(), XMLHttpRequest: Xhr as unknown as typeof XMLHttpRequest };
    const count = restrictWorkerNetwork(scope), xhr = new scope.XMLHttpRequest();
    xhr.open("GET", "/pose/asset");
    expect(() => xhr.open("POST", "https://odml.pa.googleapis.com/v1/log")).toThrow();
    expect(open).toHaveBeenCalledOnce(); expect(count()).toBe(1);
  });
});
