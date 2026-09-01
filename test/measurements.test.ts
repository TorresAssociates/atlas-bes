import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";

setDefaultTimeout(120_000);

const HOUR_MS = 60 * 60 * 1000;

let db: TestDatabase;
let app: FastifyInstance;
let admin: TestUserSession;
let clientManager: TestUserSession;
let readOnly: TestUserSession;
let dataDeviceId: number;
let torresDeviceId: number;
let inactiveDeviceId: number;
let waterChannelId: number;
let batteryChannelId: number;
let stageChannelId: number;
let inactiveChannelId: number;
let hourAgo: Date;
let twoHoursAgo: Date;
let ninetyMinutesAgo: Date;
let thirtyHoursAgo: Date;

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "measurements-admin@example.com",
		name: "Measurements Admin",
		client_id: 1,
		role_id: 1,
	});
	clientManager = await signUpTestUser(app, {
		email: "measurements-manager@example.com",
		name: "Measurements Manager",
		client_id: 2,
		role_id: 3,
	});

	// Client-scoped reader without write permission, for inactive-device gating.
	const readOnlyRole = await db.pool.query<{ id: number }>(
		`INSERT INTO role (client_id, name) VALUES (2, 'MEASUREMENTS_READ_ONLY') RETURNING id`,
	);
	await db.pool.query(`INSERT INTO role_permission (role_id, permission_id) VALUES ($1, 1)`, [
		readOnlyRole.rows[0]!.id,
	]);
	readOnly = await signUpTestUser(app, {
		email: "measurements-read-only@example.com",
		name: "Measurements Read Only",
		client_id: 2,
		role_id: readOnlyRole.rows[0]!.id,
	});

	const stations = await db.pool.query<{ id: number; name: string }>(
		`INSERT INTO gauge_station (name)
		 VALUES ('measurements-test-torres-station'), ('measurements-test-bryan-station')
		 RETURNING id, name`,
	);
	const stationId = (name: string) => stations.rows.find((s) => s.name === name)!.id;
	const torresStationId = stationId("measurements-test-torres-station");
	const bryanStationId = stationId("measurements-test-bryan-station");
	await db.pool.query(
		`INSERT INTO gauge_station_info (gauge_station_id, city_id, location, latitude, longitude)
		 VALUES ($1, 1, 'Torres Station', 30.61, -96.31), ($2, 2, 'Bryan Station', 30.67, -96.36)`,
		[torresStationId, bryanStationId],
	);
	await db.pool.query(
		`INSERT INTO client_gauge_station (gauge_station_id, client_id) VALUES ($1, 1), ($2, 2)`,
		[torresStationId, bryanStationId],
	);

	const devices = await db.pool.query<{ id: number; serial_number: string }>(
		`INSERT INTO device (serial_number)
		 VALUES ('measurements-test-data'), ('measurements-test-torres'), ('measurements-test-inactive')
		 RETURNING id, serial_number`,
	);
	const deviceId = (serial: string) => devices.rows.find((d) => d.serial_number === serial)!.id;
	dataDeviceId = deviceId("measurements-test-data");
	torresDeviceId = deviceId("measurements-test-torres");
	inactiveDeviceId = deviceId("measurements-test-inactive");
	await db.pool.query(
		`INSERT INTO device_info (device_id, gauge_station_id, type, active)
		 VALUES ($1, $2, 'datalogger', TRUE), ($3, $4, 'datalogger', TRUE), ($5, $2, 'datalogger', FALSE)`,
		[dataDeviceId, bryanStationId, torresDeviceId, torresStationId, inactiveDeviceId],
	);

	// Channels: water and battery are displayed, stage has no display row, and
	// one water channel is inactive. The water channels carry scale 2 / offset 1
	// to prove config scale/offset is NOT applied — stored values are already
	// converted.
	const channels = await db.pool.query<{ id: number; local_id: number }>(
		`INSERT INTO channel (device_id, local_id, channel_type_id)
		 VALUES ($1, 0, 1), ($1, 1, 1), ($1, 2, 1), ($1, 3, 1)
		 RETURNING id, local_id`,
		[dataDeviceId],
	);
	const channelId = (localId: number) => channels.rows.find((c) => c.local_id === localId)!.id;
	waterChannelId = channelId(0);
	batteryChannelId = channelId(1);
	stageChannelId = channelId(2);
	inactiveChannelId = channelId(3);

	await db.pool.query(
		`INSERT INTO channel_config (channel_id, name, active, category, units, scale, "offset")
		 VALUES ($1, 'water', TRUE, 'water_level', 'ft', 2, 1),
		        ($2, 'battery', TRUE, 'battery', 'V', 1, 0),
		        ($3, 'stage', TRUE, 'water_stage', 'ft', 1, 0),
		        ($4, 'water-old', FALSE, 'water_level', 'ft', 2, 1)`,
		[waterChannelId, batteryChannelId, stageChannelId, inactiveChannelId],
	);
	await db.pool.query(
		`INSERT INTO channel_config_display (channel_id, display_index) VALUES ($1, 0), ($2, 1)`,
		[waterChannelId, batteryChannelId],
	);

	const base = Date.now();
	hourAgo = new Date(base - 1 * HOUR_MS);
	twoHoursAgo = new Date(base - 2 * HOUR_MS);
	thirtyHoursAgo = new Date(base - 30 * HOUR_MS);
	ninetyMinutesAgo = new Date(base - 1.5 * HOUR_MS);

	// Inserted sequentially so the measurement_record_latest trigger sees them
	// in a deterministic order (older rows arrive after the newest one and must
	// not displace it).
	const insertRecord = (channel: number, date: Date, value: number | null) =>
		db.pool.query(
			`INSERT INTO measurement_record (date, channel_id, value)
			 VALUES ($1, $2, $3)`,
			[date, channel, value],
		);
	await insertRecord(waterChannelId, twoHoursAgo, null);
	await insertRecord(waterChannelId, hourAgo, 10);
	await insertRecord(waterChannelId, ninetyMinutesAgo, 99);
	await insertRecord(waterChannelId, thirtyHoursAgo, 5);
	await insertRecord(batteryChannelId, hourAgo, 12.5);
	await insertRecord(inactiveChannelId, hourAgo, 7);
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

interface ChannelBody {
	id: number;
	deviceId: number;
	localId: number;
	name: string;
	category: string;
	units: string;
	scale: number;
	offset: number;
	active: boolean;
	displayIndex: number | null;
}

interface DeviceDataBody {
	deviceId: number;
	from: string;
	to: string;
	data: { channel: ChannelBody; measurements: { date: string; value: number | null }[] }[];
}

interface DeviceLatestDataBody {
	deviceId: number;
	data: { channel: ChannelBody; date: string | null; value: number | null }[];
}

test("GET /v1/devices/:id/data returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: `/v1/devices/${dataDeviceId}/data` });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/devices/:id/data returns measurements grouped by channel", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${dataDeviceId}/data`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDataBody>();
	expect(body.deviceId).toBe(dataDeviceId);
	// Default window: to = now, from = to - 24h.
	expect(new Date(body.to).getTime() - new Date(body.from).getTime()).toBe(24 * HOUR_MS);

	// Ordered by display index (nulls last); the inactive channel is excluded.
	expect(body.data.map((entry) => entry.channel.id)).toEqual([
		waterChannelId,
		batteryChannelId,
		stageChannelId,
	]);

	const water = body.data[0]!;
	expect(water.channel).toEqual({
		id: waterChannelId,
		deviceId: dataDeviceId,
		localId: 0,
		name: "water",
		category: "water_level",
		units: "ft",
		scale: 2,
		offset: 1,
		active: true,
		displayIndex: 0,
	});
	// Stored values as-is (scale/offset never applied), ordered by date; the
	// 30h-old record is excluded. A null value stays null.
	expect(water.measurements).toEqual([
		{ date: twoHoursAgo.toISOString(), value: null },
		{ date: ninetyMinutesAgo.toISOString(), value: 99 },
		{ date: hourAgo.toISOString(), value: 10 },
	]);

	expect(body.data[1]!.measurements).toEqual([{ date: hourAgo.toISOString(), value: 12.5 }]);
	// A channel with no records still appears, with an empty series.
	expect(body.data[2]!.measurements).toEqual([]);
});

test("GET /v1/devices/:id/data honors a custom from/to window", async () => {
	const from = new Date(thirtyHoursAgo.getTime() - 10 * HOUR_MS).toISOString();
	const to = new Date(thirtyHoursAgo.getTime() + 10 * HOUR_MS).toISOString();
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${dataDeviceId}/data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDataBody>();
	expect(body.from).toBe(from);
	expect(body.to).toBe(to);
	expect(body.data[0]!.measurements).toEqual([{ date: thirtyHoursAgo.toISOString(), value: 5 }]);
	expect(body.data[1]!.measurements).toEqual([]);
});

test("GET /v1/devices/:id/data rejects an inverted window", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${dataDeviceId}/data?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(400);
});

test("GET /v1/devices/:id/data?channelId= limits to one channel", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${dataDeviceId}/data?channelId=${waterChannelId}`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDataBody>();
	expect(body.data).toHaveLength(1);
	expect(body.data[0]!.channel.id).toBe(waterChannelId);
});

test("GET /v1/devices/:id/data?category= filters channels by category", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${dataDeviceId}/data?category=battery`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDataBody>();
	expect(body.data.map((entry) => entry.channel.id)).toEqual([batteryChannelId]);
});

test("GET /v1/devices/:id/data?includeInactiveChannels=true includes inactive channels", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${dataDeviceId}/data?includeInactiveChannels=true`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDataBody>();
	expect(body.data).toHaveLength(4);
	const inactive = body.data.find((entry) => entry.channel.id === inactiveChannelId)!;
	expect(inactive.channel.active).toBe(false);
	expect(inactive.measurements).toEqual([{ date: hourAgo.toISOString(), value: 7 }]);
});

test("GET /v1/devices/:id/data/latest serves current values per channel", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${dataDeviceId}/data/latest`,
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceLatestDataBody>();
	expect(body.deviceId).toBe(dataDeviceId);
	expect(body.data.map((entry) => entry.channel.id)).toEqual([
		waterChannelId,
		batteryChannelId,
		stageChannelId,
	]);
	// The older record inserted later must not have displaced the latest value.
	expect(body.data[0]!.date).toBe(hourAgo.toISOString());
	expect(body.data[0]!.value).toBe(10);
	expect(body.data[1]!.value).toBe(12.5);
	// Never-reported channel: nulls, not fabricated values.
	expect(body.data[2]!.date).toBeNull();
	expect(body.data[2]!.value).toBeNull();
});

test("GET /v1/devices/:id/data/latest?includeInactive=true includes inactive channels", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${dataDeviceId}/data/latest?includeInactive=true`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceLatestDataBody>();
	const inactive = body.data.find((entry) => entry.channel.id === inactiveChannelId)!;
	expect(inactive.value).toBe(7);
});

test("GET /v1/devices/:id/data hides another client's device from session users", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${torresDeviceId}/data`,
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("GET /v1/devices/:id/data hides inactive devices from read-only users", async () => {
	const readOnlyRes = await app.inject({
		method: "GET",
		url: `/v1/devices/${inactiveDeviceId}/data`,
		headers: { cookie: readOnly.cookie },
	});
	expect(readOnlyRes.statusCode).toBe(404);

	// A writer of the same client still sees it.
	const managerRes = await app.inject({
		method: "GET",
		url: `/v1/devices/${inactiveDeviceId}/data`,
		headers: { cookie: clientManager.cookie },
	});
	expect(managerRes.statusCode).toBe(200);
});
