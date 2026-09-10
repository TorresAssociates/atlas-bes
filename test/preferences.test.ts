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
	data_vis_presets: DataVisPresetBody[];
}

interface DataVisPresetBody {
	id: number;
	preference_id: number;
	data: unknown;
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
			data_vis_presets: [],
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
			layers_on_load: ["rain", "gaugeStations"],
			favorite: { drawer: ["alerts", "map"] },
			theme: "dark",
		},
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<PreferenceBody>()).toEqual(
		expect.objectContaining({
			user_id: user.id,
			map_style: "satellite",
			layers_on_load: ["rain", "gaugeStations"],
			favorite: { drawer: ["alerts", "map"] },
			theme: "dark",
			data_vis_presets: [],
		}),
	);
});

test("POST /v1/preferences/me/data-vis-presets creates a data visualization preset", async () => {
	const presetData = {
		name: "Recent Water Levels",
		source: ["BRYTX001", "BRYTX002"],
		metric: ["water_level"],
		time_range: 86_400,
	};
	const res = await app.inject({
		method: "POST",
		url: "/v1/preferences/me/data-vis-presets",
		headers: { cookie: user.cookie },
		body: { data: presetData },
	});

	expect(res.statusCode).toBe(201);
	const preset = res.json<DataVisPresetBody>();
	expect(preset).toEqual(
		expect.objectContaining({
			data: presetData,
		}),
	);

	const getRes = await app.inject({
		method: "GET",
		url: "/v1/preferences/me",
		headers: { cookie: user.cookie },
	});
	expect(getRes.json<PreferenceBody>().data_vis_presets).toEqual([
		expect.objectContaining({ id: preset.id, data: presetData }),
	]);
});

test("POST /v1/preferences/me/data-vis-presets accepts fixed time ranges", async () => {
	const presetData = {
		name: "Fixed Water Levels",
		source: ["BRYTX001", "BRYTX002"],
		metric: ["water_level", "temperature"],
		time_range: {
			start: "2026-09-01T00:00:00.000Z",
			end: "2026-09-02T00:00:00.000Z",
		},
	};
	const res = await app.inject({
		method: "POST",
		url: "/v1/preferences/me/data-vis-presets",
		headers: { cookie: user.cookie },
		body: { data: presetData },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<DataVisPresetBody>()).toEqual(
		expect.objectContaining({
			data: presetData,
		}),
	);
});

test("PATCH /v1/preferences/me/data-vis-presets/:id updates one own preset", async () => {
	const createRes = await app.inject({
		method: "POST",
		url: "/v1/preferences/me/data-vis-presets",
		headers: { cookie: user.cookie },
		body: {
			data: {
				name: "Draft Preset",
				source: ["BRYTX001"],
				metric: ["water_level"],
				time_range: 3_600,
			},
		},
	});
	const preset = createRes.json<DataVisPresetBody>();
	const updatedPresetData = {
		name: "Updated Preset",
		source: ["BRYTX001", "BRYTX002"],
		metric: ["water_level", "temperature"],
		time_range: {
			start: "2026-09-03T00:00:00.000Z",
			end: "2026-09-04T00:00:00.000Z",
		},
	};

	const updateRes = await app.inject({
		method: "PATCH",
		url: `/v1/preferences/me/data-vis-presets/${preset.id}`,
		headers: { cookie: user.cookie },
		body: { data: updatedPresetData },
	});

	expect(updateRes.statusCode).toBe(200);
	expect(updateRes.json<DataVisPresetBody>()).toEqual(
		expect.objectContaining({
			id: preset.id,
			data: updatedPresetData,
		}),
	);

	const getRes = await app.inject({
		method: "GET",
		url: "/v1/preferences/me",
		headers: { cookie: user.cookie },
	});
	expect(getRes.json<PreferenceBody>().data_vis_presets).toContainEqual(
		expect.objectContaining({ id: preset.id, data: updatedPresetData }),
	);
});

test("PATCH /v1/preferences/me/data-vis-presets/:id cannot update another user's preset", async () => {
	const createRes = await app.inject({
		method: "POST",
		url: "/v1/preferences/me/data-vis-presets",
		headers: { cookie: user.cookie },
		body: {
			data: {
				name: "Protected Preset",
				source: ["BRYTX005"],
				metric: ["water_level"],
				time_range: 3_600,
			},
		},
	});
	const preset = createRes.json<DataVisPresetBody>();

	const updateRes = await app.inject({
		method: "PATCH",
		url: `/v1/preferences/me/data-vis-presets/${preset.id}`,
		headers: { cookie: otherUser.cookie },
		body: {
			data: {
				name: "Should Not Update",
				source: ["BRYTX006"],
				metric: ["temperature"],
				time_range: 7_200,
			},
		},
	});

	expect(updateRes.statusCode).toBe(404);
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
			data_vis_presets: [],
		}),
	);
});

test("DELETE /v1/preferences/me/data-vis-presets/:id removes one own preset", async () => {
	const createRes = await app.inject({
		method: "POST",
		url: "/v1/preferences/me/data-vis-presets",
		headers: { cookie: user.cookie },
		body: {
			data: {
				name: "Last Hour",
				source: ["BRYTX003"],
				metric: ["water_level"],
				time_range: 3_600,
			},
		},
	});
	const preset = createRes.json<DataVisPresetBody>();

	const deleteRes = await app.inject({
		method: "DELETE",
		url: `/v1/preferences/me/data-vis-presets/${preset.id}`,
		headers: { cookie: user.cookie },
	});

	expect(deleteRes.statusCode).toBe(204);

	const getRes = await app.inject({
		method: "GET",
		url: "/v1/preferences/me",
		headers: { cookie: user.cookie },
	});
	expect(getRes.json<PreferenceBody>().data_vis_presets).not.toContainEqual(
		expect.objectContaining({ id: preset.id }),
	);
});

test("DELETE /v1/preferences/me/data-vis-presets/:id cannot remove another user's preset", async () => {
	const createRes = await app.inject({
		method: "POST",
		url: "/v1/preferences/me/data-vis-presets",
		headers: { cookie: user.cookie },
		body: {
			data: {
				name: "Other User Guard",
				source: ["BRYTX004"],
				metric: ["water_level"],
				time_range: 3_600,
			},
		},
	});
	const preset = createRes.json<DataVisPresetBody>();

	const deleteRes = await app.inject({
		method: "DELETE",
		url: `/v1/preferences/me/data-vis-presets/${preset.id}`,
		headers: { cookie: otherUser.cookie },
	});

	expect(deleteRes.statusCode).toBe(404);
});
