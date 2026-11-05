import { expect, test } from "./support";

// The smallest check a deployed environment gets first: the Worker answers, says which
// environment it is, and its API answers are never cached.

test.describe("health", () => {
  test("the Worker answers its health check", { tag: "@smoke" }, async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = (await res.json()) as { ok: boolean; env: string };
    expect(body.ok).toBe(true);
    expect(["development", "staging", "production"]).toContain(body.env);
    // Unknown API paths answer JSON, not the app's HTML.
    const missing = await request.get("/api/no-such-thing");
    expect(missing.status()).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });
});
