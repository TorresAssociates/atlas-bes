import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import type { MqtxClient } from "@/lib/mqtx/MqtxClient";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;
let admin: TestUserSession;
let clientManager: TestUserSession;
let deviceOnlyUser: TestUserSession;

const mqtxCalls: Array<{
	method: string;
	deviceId: string;
	version?: string;
	payload?: unknown;
}> = [];

const fakeMqtx = {
	async sendStateUpdate(deviceId: string, version: string, payload: unknown) {
		mqtxCalls.push({ method: "state", deviceId, version, payload });
		return { status: 200, success: true, body: "" };
	},
	async sendConfigUpdate(deviceId: string, version: string, payload: unknown) {
		mqtxCalls.push({ method: "config", deviceId, version, payload });
		return { status: 200, success: true, body: "" };
	},
	async sendDataGet(deviceId: string, version: string, codes: string[]) {
		mqtxCalls.push({
			method: "data",
			deviceId,
			version,
			payload: { codes },
		});
		return { status: 200, success: true, body: "" };
	},
	async sendPing(deviceId: string, version: string) {
		mqtxCalls.push({ method: "ping", deviceId, version });
		return { status: 200, success: true, body: "" };
	},
	async sendV1LightsCommand(deviceId: string, command: "ON" | "OFF") {
		mqtxCalls.push({
			method: "lights",
			deviceId,
			payload: { command, source: "frontend" },
		});
		return { status: 200, success: true, body: "" };
	},
} as unknown as MqtxClient;

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false, mqtx: fakeMqtx });

	admin = await signUpTestUser(app, {
		email: "mqtx-admin@example.com",
		name: "MQTX Admin",
		client_id: 1,
		role_id: 1,
	});
	const deviceOnlyRole = await db.pool.query<{ id: number }>(
		`INSERT INTO role (name, client_id) VALUES ('MQTX_DEVICE_ONLY', 2) RETURNING id`,
	);
	await db.pool.query(
		`INSERT INTO role_permission (role_id, permission_id) VALUES ($1, 1), ($1, 2)`,
		[deviceOnlyRole.rows[0]!.id],
	);
	deviceOnlyUser = await signUpTestUser(app, {
		email: "mqtx-device-only@example.com",
		name: "MQTX Device Only",
		client_id: 2,
		role_id: deviceOnlyRole.rows[0]!.id,
	});

	clientManager = await signUpTestUser(app, {
		email: "mqtx-client-manager@example.com",
		name: "MQTX Client Manager",
		client_id: 2,
		role_id: 3,
	});
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("POST /v1/mqtx/:deviceId/control sends wifi state to MQTX", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/mqtx/bryan-test-device/control",
		headers: { cookie: clientManager.cookie },
		body: { controlType: "wifi", requestedState: true },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ success: boolean }>()).toEqual({ success: true });
	expect(mqtxCalls).toContainEqual({
		method: "state",
		deviceId: "bryan",
		version: "v2",
		payload: { wifiInterface: { enabled: true } },
	});
});

test("POST /v1/mqtx/:deviceId/control requires control panel write permission", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/mqtx/bryan-test-device/control",
		headers: { cookie: deviceOnlyUser.cookie },
		body: { controlType: "wifi", requestedState: true },
	});

	expect(res.statusCode).toBe(403);
	expect(mqtxCalls).toEqual([]);
});

test("POST /v1/mqtx/:deviceId/control supports v1 light override", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/mqtx/bryan-test-device/control",
		headers: { cookie: clientManager.cookie },
		body: { controlType: "override", version: "v1", requestedState: false },
	});

	expect(res.statusCode).toBe(200);
	expect(mqtxCalls).toContainEqual({
		method: "lights",
		deviceId: "bryan",
		payload: { command: "OFF", source: "frontend" },
	});
});

test("POST /v1/mqtx/:deviceId/control hides another client's device", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/mqtx/college-station-test-device/control",
		headers: { cookie: clientManager.cookie },
		body: { controlType: "ping" },
	});

	expect(res.statusCode).toBe(404);
	expect(mqtxCalls).toEqual([]);
});

test("PUT /v1/mqtx/:deviceId/settings/alerts sends monitored codes to MQTX", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "PUT",
		url: "/v1/mqtx/bryan-test-device/settings/alerts",
		headers: { cookie: clientManager.cookie },
		body: {
			version: "v2",
			monitoredCodes: [{ channelCodeId: "WL", operation: ">", threshold: 2.5 }],
		},
	});

	expect(res.statusCode).toBe(204);
	expect(mqtxCalls).toContainEqual({
		method: "config",
		deviceId: "bryan-test-device",
		version: "v2",
		payload: {
			config: {
				monitoredCodes: [{ code: "WL", operation: ">", threshold: 2.5 }],
			},
		},
	});
});

test("POST /v1/mqtx/:deviceId/settings/data sends data config and records timestep", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/mqtx/bryan-test-device/settings/data",
		headers: { cookie: clientManager.cookie },
		body: {
			version: "v2",
			timestep: 300,
			minTimestep: 60,
			channels: [
				{
					localChannelId: 1,
					channelName: "Stage",
					isActive: true,
					channelCodeId: "WL",
					units: "ft",
					displayIndex: 1,
					channelTimestep: 300,
					channelTypeId: 1,
				},
			],
		},
	});

	expect(res.statusCode).toBe(200);
	expect(mqtxCalls[0]).toEqual(
		expect.objectContaining({
			method: "config",
			deviceId: "bryan-test-device",
		}),
	);
	const row = await db.pool.query<{ timestep: number }>(
		`SELECT timestep FROM device_datalogging WHERE device_id = 1 AND archived IS NULL ORDER BY id DESC LIMIT 1`,
	);
	expect(row.rows).toEqual([{ timestep: 300 }]);
});

test("POST /v1/mqtx/:deviceId/settings/general sends wifi settings and records wifi active", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/mqtx/bryan-test-device/settings/general",
		headers: { cookie: clientManager.cookie },
		body: {
			version: "v2",
			wifiEnabled: false,
			wifiPassword: "new-password",
		},
	});

	expect(res.statusCode).toBe(200);
	expect(mqtxCalls).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				method: "state",
				payload: { wifiInterface: { enabled: false } },
			}),
			expect.objectContaining({
				method: "config",
				payload: { wifiInterface: { password: "new-password" } },
			}),
		]),
	);
	const active = await db.pool.query<{ wifi_active: boolean }>(
		`SELECT wifi_active FROM device_wifi_interface_active WHERE device_id = 1 AND archived IS NULL ORDER BY id DESC LIMIT 1`,
	);
	expect(active.rows).toEqual([{ wifi_active: false }]);
});

test("POST /v1/mqtx/:deviceId/settings/power records voltage limits", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/mqtx/bryan-test-device/settings/power",
		headers: { cookie: clientManager.cookie },
		body: { min: 11.126, max: 14.994 },
	});

	expect(res.statusCode).toBe(200);
	const power = await db.pool.query<{
		min_voltage: number;
		max_voltage: number;
	}>(
		`SELECT min_voltage, max_voltage FROM device_power WHERE device_id = 1 AND archived IS NULL ORDER BY id DESC LIMIT 1`,
	);
	expect(power.rows).toEqual([{ min_voltage: 11.13, max_voltage: 14.99 }]);
});

test("POST /v1/mqtx/:deviceId/control returns 501 for old overtop DB-only control", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/mqtx/bryan-test-device/control",
		headers: { cookie: clientManager.cookie },
		body: { controlType: "overtop", requestedState: true },
	});

	expect(res.statusCode).toBe(501);
});

test("POST /v1/mqtx/:deviceId/settings/power lets admins update another client's device", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/mqtx/college-station-test-device/settings/power",
		headers: { cookie: admin.cookie },
		body: { min: 10, max: 15 },
	});

	expect(res.statusCode).toBe(200);
});
