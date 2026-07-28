import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/server";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";

// Container startup dominates; well past the default 5s per-test timeout.
setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;

// Set by the POST test, reused by the PATCH/DELETE tests below it — tests in
// this file are order-dependent and run sequentially.
let createdId: number;

beforeAll(async () => {
  stubConfigEnv();
  db = await startTestDatabase();
  app = await buildApp({ pool: db.pool, logger: false });
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

test("GET /v1/clients lists the seeded clients as { data: [...] }", async () => {
  const res = await app.inject({ method: "GET", url: "/v1/clients" });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ data: Array<{ id: number; name: string }> }>();
  expect(body.data).toEqual([
    { id: 1, name: "Torres & Associates" },
    { id: 2, name: "City of Bryan" },
  ]);
});

// Looks a client up via the list endpoint (there is no GET-single endpoint).
async function findClient(id: number): Promise<{ id: number; name: string } | undefined> {
  const res = await app.inject({ method: "GET", url: "/v1/clients" });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: Array<{ id: number; name: string }> }>().data.find((c) => c.id === id);
}

test("POST /v1/clients creates a client", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/clients",
    body: { name: "Acme Water District" },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ id: number; name: string }>();
  expect(body.name).toBe("Acme Water District");
  expect(body.id).toBeGreaterThan(2);
  createdId = body.id;

  expect(await findClient(createdId)).toEqual({ id: createdId, name: "Acme Water District" });
});

test("POST /v1/clients returns 409 on a duplicate name", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/clients",
    body: { name: "City of Bryan" },
  });
  expect(res.statusCode).toBe(409);
  const body = res.json<{ statusCode: number; error: string; message: string }>();
  expect(body.error).toBe("Conflict");
  expect(body.message).toContain("City of Bryan");
});

test("POST /v1/clients returns 400 on an empty name", async () => {
  const res = await app.inject({ method: "POST", url: "/v1/clients", body: { name: "" } });
  expect(res.statusCode).toBe(400);
});

test("PATCH /v1/clients/:id renames a client", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/clients/${createdId}`,
    body: { name: "Acme Hydrology" },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json<object>()).toEqual({ id: createdId, name: "Acme Hydrology" });
});

test("PATCH /v1/clients/:id returns 404 for a nonexistent id", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/v1/clients/9999",
    body: { name: "Ghost Client" },
  });
  expect(res.statusCode).toBe(404);
  const body = res.json<{ statusCode: number; error: string; message: string }>();
  expect(body.error).toBe("Not Found");
  expect(body.message).toContain("9999");
});

test("PATCH /v1/clients/:id returns 400 for a non-integer id", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/v1/clients/abc",
    body: { name: "Whatever" },
  });
  expect(res.statusCode).toBe(400);
});

test("PATCH /v1/clients/:id returns 409 when renaming onto an existing name", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/clients/${createdId}`,
    body: { name: "City of Bryan" },
  });
  expect(res.statusCode).toBe(409);
});

test("DELETE /v1/clients/:id deletes a client without users", async () => {
  const res = await app.inject({ method: "DELETE", url: `/v1/clients/${createdId}` });
  expect(res.statusCode).toBe(204);
  expect(res.body).toBe("");

  expect(await findClient(createdId)).toBeUndefined();
});

test("DELETE /v1/clients/:id returns 404 for a nonexistent id", async () => {
  const res = await app.inject({ method: "DELETE", url: "/v1/clients/9999" });
  expect(res.statusCode).toBe(404);
});

test("DELETE /v1/clients/:id returns 409 when the client still has users", async () => {
  await db.pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, client_id, role_id, updated_at)
     VALUES ('test-user-1', 'Test User', 'test-user@example.com', false, 1, 1, now())`,
  );
  const res = await app.inject({ method: "DELETE", url: "/v1/clients/1" });
  expect(res.statusCode).toBe(409);
  const body = res.json<{ error: string; message: string }>();
  expect(body.error).toBe("Conflict");
  expect(body.message).toContain("user");

  // Still there afterwards.
  expect(await findClient(1)).toEqual({ id: 1, name: "Torres & Associates" });
});
