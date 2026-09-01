import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;
let admin: TestUserSession;
let clientManager: TestUserSession;
let bryanChannelId: number;
let collegeStationChannelId: number;

interface ChannelRecordBody {
	channel: {
		id: number;
		device_id: number;
		local_id: number;
		channel_type_id: number;
		introduced: string;
		archived: string | null;
	};
	channel_config: {
		id: number;
		channel_id: number;
		name: string;
		active: boolean;
		category: string;
		units: string;
		scale: number;
		offset: number;
		introduced: string;
		archived: string | null;
	} | null;
	channel_config_display: { display_index: number } | null;
	channel_config_internal_power_sensor: {
		measurement_type: "voltage" | "current" | "power";
	} | null;
	channel_config_sdi12: unknown | null;
	channel_config_accumulation: unknown | null;
	channel_config_tilt: unknown | null;
}

async function insertChannel(input: {
	deviceId: number;
	localId: number;
	name: string;
	category: string;
	units: string;
}): Promise<number> {
	const channel = await db.pool.query<{ id: number }>(
		`INSERT INTO channel (device_id, local_id, channel_type_id) VALUES ($1, $2, $3) RETURNING id`,
		[input.deviceId, input.localId, 1],
	);
	const row = channel.rows[0];
	if (!row) throw new Error("channel insert returned no row");

	await db.pool.query(
		`INSERT INTO channel_config (channel_id, name, active, category, units, scale, "offset") VALUES ($1, $2, TRUE, $3, $4, 1, 0)`,
		[row.id, input.name, input.category, input.units],
	);
	await db.pool.query(
		`INSERT INTO channel_config_display (channel_id, display_index) VALUES ($1, $2)`,
		[row.id, input.localId],
	);
	return row.id;
}

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "channels-admin@example.com",
		name: "Channels Admin",
		client_id: 1,
		role_id: 1,
	});
	clientManager = await signUpTestUser(app, {
		email: "channels-client-manager@example.com",
		name: "Channels Client Manager",
		client_id: 2,
		role_id: 3,
	});

	bryanChannelId = await insertChannel({
		deviceId: 1,
		localId: 1,
		name: "Stage",
		category: "water",
		units: "ft",
	});
	collegeStationChannelId = await insertChannel({
		deviceId: 2,
		localId: 2,
		name: "Rain",
		category: "rain",
		units: "in",
	});
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("GET /v1/channels limits client readers to their client's device channels", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/channels",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const channelDeviceIds = res
		.json<{ data: ChannelRecordBody[] }>()
		.data.map((record) => record.channel.device_id);
	expect(channelDeviceIds).toContain(1);
	expect(channelDeviceIds).not.toContain(2);
});

test("GET /v1/channels lets admins list channels across clients", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/channels",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const channelDeviceIds = res
		.json<{ data: ChannelRecordBody[] }>()
		.data.map((record) => record.channel.device_id);
	expect(channelDeviceIds).toContain(1);
	expect(channelDeviceIds).toContain(2);
});
test("GET /v1/channels/device/:deviceId lists channels and configs for a same-client device", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/channels/device/1",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<{ data: ChannelRecordBody[] }>();
	expect(body.data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				channel: expect.objectContaining({
					id: bryanChannelId,
					device_id: 1,
					local_id: 1,
					channel_type_id: 1,
				}),
				channel_config: expect.objectContaining({
					channel_id: bryanChannelId,
					name: "Stage",
					active: true,
					category: "water",
					units: "ft",
					scale: 1,
					offset: 0,
				}),
				channel_config_display: expect.objectContaining({ display_index: 1 }),
			}),
		]),
	);
});

test("GET /v1/channels/device/:deviceId lets admins list another client's device channels", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/channels/device/2",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ data: ChannelRecordBody[] }>().data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				channel: expect.objectContaining({ id: collegeStationChannelId, device_id: 2 }),
				channel_config: expect.objectContaining({ name: "Rain" }),
			}),
		]),
	);
});

test("GET /v1/channels/device/:deviceId hides another client's device from client readers", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/channels/device/2",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("GET /v1/channels/:id returns one visible channel with channel_config", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/channels/${bryanChannelId}`,
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<ChannelRecordBody>()).toEqual(
		expect.objectContaining({
			channel: expect.objectContaining({ id: bryanChannelId, device_id: 1 }),
			channel_config: expect.objectContaining({ name: "Stage" }),
		}),
	);
});
