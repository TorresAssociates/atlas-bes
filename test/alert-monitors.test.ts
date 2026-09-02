import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";
import { seedDeviceFixtures } from "./helpers/fixtures";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;
let admin: TestUserSession;
let clientManager: TestUserSession;
let alertId: number;
let clientMonitorId: number;
let adminMonitorId: number;

interface TimelineBody {
	id: number;
	introduced: string;
	archived: string | null;
}

interface AlertMonitorBody extends TimelineBody {
	device_id: number;
	local_id: number;
	type_id: number;
}

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	await seedDeviceFixtures(db.pool);
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "alert-monitors-admin@example.com",
		name: "Alert Monitors Admin",
		client_id: 1,
		role_id: 1,
	});
	clientManager = await signUpTestUser(app, {
		email: "alert-monitors-manager@example.com",
		name: "Alert Monitors Manager",
		client_id: 2,
		role_id: 3,
	});

	const alert = await db.pool.query<{ id: number }>(
		`INSERT INTO alert (client_id, type, level) VALUES (2, 'overtop', 'device') RETURNING id`,
	);
	const alertRow = alert.rows[0];
	if (!alertRow) throw new Error("alert insert returned no row");
	alertId = alertRow.id;
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("POST /v1/alert-monitors creates a monitor for a same-client device", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alert-monitors",
		headers: { cookie: clientManager.cookie },
		body: { device_id: 1, local_id: 10, type_id: 1 },
	});

	expect(res.statusCode).toBe(201);
	const body = res.json<AlertMonitorBody>();
	expect(body).toEqual(
		expect.objectContaining({
			device_id: 1,
			local_id: 10,
			type_id: 1,
			archived: null,
		}),
	);
	clientMonitorId = body.id;
});

test("POST /v1/alert-monitors hides another client's device from client writers", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alert-monitors",
		headers: { cookie: clientManager.cookie },
		body: { device_id: 2, local_id: 11, type_id: 1 },
	});

	expect(res.statusCode).toBe(404);
});

test("POST /v1/alert-monitors lets admins create across clients", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alert-monitors",
		headers: { cookie: admin.cookie },
		body: { device_id: 2, local_id: 12, type_id: 1 },
	});

	expect(res.statusCode).toBe(201);
	adminMonitorId = res.json<AlertMonitorBody>().id;
});

test("POST /v1/alert-monitors/configs adds alert monitor config rows", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alert-monitors/configs",
		headers: { cookie: clientManager.cookie },
		body: { alert_monitor_id: clientMonitorId, alert_id: alertId },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json()).toEqual(
		expect.objectContaining({
			alert_monitor_id: clientMonitorId,
			alert_id: alertId,
			archived: null,
		}),
	);
});

test("POST /v1/alert-monitors/activities adds activity rows", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alert-monitors/activities",
		headers: { cookie: clientManager.cookie },
		body: { alert_monitor_id: clientMonitorId, active: true },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json()).toEqual(
		expect.objectContaining({
			alert_monitor_id: clientMonitorId,
			active: true,
			archived: null,
		}),
	);
});

test("POST /v1/alert-monitors/activity-overrides adds nullable override rows", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alert-monitors/activity-overrides",
		headers: { cookie: clientManager.cookie },
		body: { alert_monitor_id: clientMonitorId, override: null },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json()).toEqual(
		expect.objectContaining({
			alert_monitor_id: clientMonitorId,
			override: null,
			archived: null,
		}),
	);
});

test("POST /v1/alert-monitors/channel-links links same-device channels", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alert-monitors/channel-links",
		headers: { cookie: clientManager.cookie },
		body: { alert_monitor_id: clientMonitorId, channel_id: 1 },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json()).toEqual(
		expect.objectContaining({
			alert_monitor_id: clientMonitorId,
			channel_id: 1,
			archived: null,
		}),
	);
});

test("POST /v1/alert-monitors/channel-links rejects channels from a different device", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alert-monitors/channel-links",
		headers: { cookie: admin.cookie },
		body: { alert_monitor_id: clientMonitorId, channel_id: 3 },
	});

	expect(res.statusCode).toBe(400);
});

test("POST /v1/alert-monitors/ranges adds range rows", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alert-monitors/ranges",
		headers: { cookie: clientManager.cookie },
		body: {
			alert_monitor_id: clientMonitorId,
			min_value: 10.5,
			max_value: 20.25,
		},
	});

	expect(res.statusCode).toBe(201);
	expect(res.json()).toEqual(
		expect.objectContaining({
			alert_monitor_id: clientMonitorId,
			min_value: 10.5,
			max_value: 20.25,
			archived: null,
		}),
	);
});

test("GET /v1/alert-monitors/status includes latest measurement records", async () => {
	const measuredAt = new Date("2026-08-13T12:00:00.000Z");
	await db.pool.query(
		`INSERT INTO measurement_record (date, channel_id, value) VALUES ($1, $2, $3)`,
		[measuredAt, 1, 15.75],
	);

	const res = await app.inject({
		method: "GET",
		url: "/v1/alert-monitors/status",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<{
		data: Array<{
			alert_monitor_id: number;
			device_id: number;
			alert_id: number;
			active: boolean;
			override: boolean | null;
			channel_id: number;
			range: { id: number; min_value: number; max_value: number } | null;
			measurement_record_latest: { id: string; date: string; value: number | null } | null;
			gauge_station: { id: number; name: string; location: string };
		}>;
	}>();
	const status = body.data.find((row) => row.alert_monitor_id === clientMonitorId);
	expect(status).toBeDefined();
	if (!status) throw new Error("client monitor status missing from response");
	expect(status).toEqual(
		expect.objectContaining({
			alert_monitor_id: clientMonitorId,
			device_id: 1,
			alert_id: alertId,
			active: true,
			override: null,
			channel_id: 1,
		}),
	);
	expect(status.range).toEqual(expect.objectContaining({ min_value: 10.5, max_value: 20.25 }));
	expect(status.measurement_record_latest).toEqual(
		expect.objectContaining({ date: measuredAt.toISOString(), value: 15.75 }),
	);
	expect(status.gauge_station).toEqual(
		expect.objectContaining({ id: 1, name: "bryan-test-gauge" }),
	);
	expect(body.data.every((row) => row.device_id === 1)).toBe(true);
});
test("GET /v1/alert-monitors returns hydrated same-client monitors", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/alert-monitors",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<{
		data: Array<{
			alert_monitor: AlertMonitorBody;
			configs: unknown[];
			activities: unknown[];
			activity_overrides: unknown[];
			channel_links: unknown[];
			ranges: unknown[];
		}>;
	}>();
	const ids = body.data.map((record) => record.alert_monitor.id);
	expect(ids).toContain(clientMonitorId);
	expect(ids).not.toContain(adminMonitorId);

	const monitor = body.data.find((record) => record.alert_monitor.id === clientMonitorId);
	expect(monitor).toBeDefined();
	if (!monitor) throw new Error("client monitor missing from response");
	expect(monitor.configs).toHaveLength(1);
	expect(monitor.activities).toHaveLength(1);
	expect(monitor.activity_overrides).toHaveLength(1);
	expect(monitor.channel_links).toHaveLength(1);
	expect(monitor.ranges).toHaveLength(1);
});

test("GET table endpoints are scoped to the caller's client", async () => {
	for (const url of [
		"/v1/alert-monitors/configs",
		"/v1/alert-monitors/activities",
		"/v1/alert-monitors/activity-overrides",
		"/v1/alert-monitors/channel-links",
		"/v1/alert-monitors/ranges",
	]) {
		const res = await app.inject({
			method: "GET",
			url,
			headers: { cookie: clientManager.cookie },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ data: Array<{ alert_monitor_id: number }> }>();
		expect(body.data.every((row) => row.alert_monitor_id === clientMonitorId)).toBe(true);
	}
});
