import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import type { RainbowClient } from "@/lib/rainbow/RainbowClient";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;
let user: TestUserSession;

let snapshotFetches = 0;

const fakeRainbow = {
	async getSnapshot() {
		snapshotFetches += 1;
		return { snapshot: 1755600000 };
	},
} as unknown as RainbowClient;

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false, rainbow: fakeRainbow });

	user = await signUpTestUser(app, {
		email: "radar-user@example.com",
		name: "Radar User",
		client_id: 1,
		role_id: 1,
	});
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("GET /v1/radar/snapshot requires authentication", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/radar/snapshot" });

	expect(res.statusCode).toBe(401);
});

test("GET /v1/radar/snapshot returns the Rainbow snapshot", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/radar/snapshot",
		headers: { cookie: user.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ snapshot: number }>()).toEqual({ snapshot: 1755600000 });
	expect(res.headers["cache-control"]).toBe("private, max-age=30");
});

test("GET /v1/radar/snapshot serves repeat requests from the cache", async () => {
	const before = snapshotFetches;

	for (let i = 0; i < 3; i++) {
		const res = await app.inject({
			method: "GET",
			url: "/v1/radar/snapshot",
			headers: { cookie: user.cookie },
		});
		expect(res.statusCode).toBe(200);
	}

	// The first authenticated request above already populated the cache, so
	// none of these hit the upstream client again.
	expect(snapshotFetches).toBe(before);
});
