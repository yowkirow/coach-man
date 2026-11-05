import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { drainUnreadBody } from "../../src/worker/lib/drain";

// Miniflare's local proxy fails a request whose body the Worker never read; the API reads any
// unread body after its route answers (src/worker/lib/drain.ts).

function app() {
  const a = new Hono()
    .use("*", drainUnreadBody)
    .post("/archive", (c) => c.json({ archived: true }))
    .post("/notes", async (c) => c.json(await c.req.json(), 201))
    .post("/refused", () => {
      throw new HTTPException(403, { message: "No." });
    })
    .get("/today", (c) => c.json({ ok: true }));
  a.onError((err, c) =>
    c.json({ error: err.message }, err instanceof HTTPException ? err.status : 500),
  );
  return a;
}

const post = (path: string, body = "{}") =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });

describe("unread request bodies", () => {
  it("are read after a route that answers without them", async () => {
    const req = post("/archive");
    const res = await app().fetch(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ archived: true });
    expect(req.bodyUsed).toBe(true);
  });

  it("are read when the route refuses before reading them", async () => {
    const req = post("/refused", JSON.stringify({ title: "x".repeat(10_000) }));
    const res = await app().fetch(req);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "No." });
    expect(req.bodyUsed).toBe(true);
  });

  it("stay as the route read them", async () => {
    const req = post("/notes", JSON.stringify({ body: "Good footwork." }));
    const res = await app().fetch(req);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ body: "Good footwork." });
  });

  it("leave reads alone", async () => {
    const req = new Request("http://localhost/today");
    const res = await app().fetch(req);
    expect(res.status).toBe(200);
    expect(req.bodyUsed).toBe(false);
  });
});
