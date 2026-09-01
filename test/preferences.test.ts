import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;
let user: TestUserSession;
let otherUser: TestUserSession;

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	user = await signUpTestUser(app, {
		email: "preferences-user@example.com",
		name: "Preferences User",
		client_id: 2,
		role_id: 4,
	});
	otherUser = await signUpTestUser(app, {
		email: "preferences-other-user@example.com",
		name: "Preferences Other User",
		client_id: 2,
		role_id: 4,
	});
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

interface PreferenceBody {
	id: number;
	user_id: string;
	map_style: string | null;
	layers_on_load: unknown;
	favorite: unknown;
	theme: string | null;
	data_vis_preset: unknown;
}

test("GET /v1/preferences/me returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/preferences/me" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/preferences/me creates and returns default preferences for the current user", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/preferences/me",
		headers: { cookie: user.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<PreferenceBody>()).toEqual(
		expect.objectContaining({
			user_id: user.id,
			map_style: null,
			layers_on_load: null,
			favorite: null,
			theme: null,
			data_vis_preset: null,
		}),
	);
});

test("PATCH /v1/preferences/me updates JSON and text preferences", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: "/v1/preferences/me",
		headers: { cookie: user.cookie },
		body: {
			map_style: "satellite",
			layers_on_load: ["rain", "gauges"],
			favorite: { drawer: ["alerts", "map"] },
			theme: "dark",
			data_vis_preset: { range: "24h", series: ["rainfall"] },
		},
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<PreferenceBody>()).toEqual(
		expect.objectContaining({
			user_id: user.id,
			map_style: "satellite",
			layers_on_load: ["rain", "gauges"],
			favorite: { drawer: ["alerts", "map"] },
			theme: "dark",
			data_vis_preset: { range: "24h", series: ["rainfall"] },
		}),
	);
});

test("PATCH /v1/preferences/me can clear nullable preference fields", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: "/v1/preferences/me",
		headers: { cookie: user.cookie },
		body: { map_style: null, favorite: null },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<PreferenceBody>()).toEqual(
		expect.objectContaining({
			user_id: user.id,
			map_style: null,
			favorite: null,
			theme: "dark",
		}),
	);
});

test("GET /v1/preferences/me only returns the current user's preferences", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/preferences/me",
		headers: { cookie: otherUser.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<PreferenceBody>()).toEqual(
		expect.objectContaining({
			user_id: otherUser.id,
			map_style: null,
			theme: null,
		}),
	);
});
