import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { getSession } from "@/modules/auth/service";
import { buildApp } from "@/server";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  stubConfigEnv();
  db = await startTestDatabase();
  app = await buildApp({ pool: db.pool, logger: false });
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

test("better-auth is mounted at /v1/auth/*", async () => {
  const res = await app.inject({ method: "GET", url: "/v1/auth/ok" });
  expect(res.statusCode).toBe(200);
  expect(res.json<{ ok: boolean }>().ok).toBe(true);
});

test("open signup is disabled", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/sign-up/email",
    body: {
      name: "Walk-in User",
      email: "walk-in@example.com",
      password: "correct-horse-battery-staple",
      client_id: 1,
      role_id: 1,
    },
  });
  expect(res.statusCode).toBeGreaterThanOrEqual(400);

  const users = await db.pool.query(`SELECT count(*)::int AS n FROM "user"`);
  expect(users.rows[0].n).toBe(0);
});

test("sign-in with unknown credentials fails without a raw error", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/sign-in/email",
    body: { email: "nobody@example.com", password: "wrong-password-123" },
  });
  expect(res.statusCode).toBe(401);
});

test("getSession returns null without a session cookie", async () => {
  expect(await getSession({ headers: {} })).toBeNull();
});

test("CORS allows the configured frontend origin with credentials", async () => {
  const res = await app.inject({
    method: "OPTIONS",
    url: "/v1/clients",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "GET",
    },
  });
  expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  expect(res.headers["access-control-allow-credentials"]).toBe("true");
});

test("CORS rejects other origins", async () => {
  const res = await app.inject({
    method: "OPTIONS",
    url: "/v1/clients",
    headers: {
      origin: "https://evil.example.com",
      "access-control-request-method": "GET",
    },
  });
  expect(res.headers["access-control-allow-origin"]).toBeUndefined();
});
