import { afterAll, beforeAll, expect, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/server";
import { stubConfigEnv } from "./helpers/database";

// buildApp({ database: false }) exists exactly for this: exercising the HTTP
// surface with app.inject() and no database. DB-backed tests will use
// @testcontainers/postgresql and pass a real pool in.
let app: FastifyInstance;

beforeAll(async () => {
	stubConfigEnv();
	app = await buildApp({ database: false, logger: false });
});

afterAll(async () => {
	await app.close();
});

test("/health returns 200 without any dependencies", async () => {
	const res = await app.inject({ method: "GET", url: "/health" });
	expect(res.statusCode).toBe(200);
	expect(res.json<{ status: string }>()).toEqual({ status: "ok" });
});

test("/ready returns 503 when no database pool is configured", async () => {
	const res = await app.inject({ method: "GET", url: "/ready" });
	expect(res.statusCode).toBe(503);
	expect(res.json().database.error).toBe("no database pool configured");
});

test("/docs serves swagger-ui", async () => {
	const res = await app.inject({ method: "GET", url: "/docs" });
	// swagger-ui redirects /docs to its static index
	expect([200, 302]).toContain(res.statusCode);
});
