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
let readOnly: TestUserSession;
let torresStationId: number;
let bryanStationId: number;
let fullDeviceId: number;
let cameraDeviceId: number;
let inactiveDeviceId: number;
let archivedDeviceId: number;
let priorityDeviceId: number;
let channelRangeId: number;
let channelGradientId: number;
let rangeMonitorId: number;
let gradientMonitorId: number;

function must<T>(value: T | undefined, message: string): T {
	if (value === undefined) throw new Error(message);
	return value;
}

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "devices-admin@example.com",
		name: "Devices Admin",
		client_id: 1,
		role_id: 1,
	});
	clientManager = await signUpTestUser(app, {
		email: "devices-manager@example.com",
		name: "Devices Manager",
		client_id: 2,
		role_id: 3,
	});

	// A client-scoped reader with no write permission, for the inactive-device
	// visibility gating (R_CLIENT_DEVICES only).
	const readOnlyRole = await db.pool.query<{ id: number }>(
		`INSERT INTO role (client_id, name) VALUES (2, 'DEVICES_READ_ONLY') RETURNING id`,
	);
	const readOnlyRoleRow = must(readOnlyRole.rows[0], "read-only role fixture was not seeded");
	await db.pool.query(`INSERT INTO role_permission (role_id, permission_id) VALUES ($1, 1)`, [
		readOnlyRoleRow.id,
	]);
	readOnly = await signUpTestUser(app, {
		email: "devices-read-only@example.com",
		name: "Devices Read Only",
		client_id: 2,
		role_id: readOnlyRoleRow.id,
	});

	// Stations: one linked to client 1 (Torres), one to client 2 (Bryan).
	const stations = await db.pool.query<{ id: number; name: string }>(
		`INSERT INTO gauge_station (name)
		 VALUES ('devices-test-torres-station'), ('devices-test-bryan-station')
		 RETURNING id, name`,
	);
	torresStationId = must(
		stations.rows.find((s) => s.name === "devices-test-torres-station"),
		"Torres station fixture was not seeded",
	).id;
	bryanStationId = must(
		stations.rows.find((s) => s.name === "devices-test-bryan-station"),
		"Bryan station fixture was not seeded",
	).id;
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
		`INSERT INTO device (serial_number, introduced)
		 VALUES ('devices-test-full', '2026-01-01'),
		        ('devices-test-camera', '2026-01-01'),
		        ('devices-test-inactive', '2026-01-01'),
		        ('devices-test-archived', '2026-01-01')
		 RETURNING id, serial_number`,
	);
	const deviceId = (serial: string) =>
		must(
			devices.rows.find((d) => d.serial_number === serial),
			`device fixture ${serial} was not seeded`,
		).id;
	fullDeviceId = deviceId("devices-test-full");
	cameraDeviceId = deviceId("devices-test-camera");
	inactiveDeviceId = deviceId("devices-test-inactive");
	archivedDeviceId = deviceId("devices-test-archived");
	await db.pool.query(`UPDATE device SET archived = '2026-06-01' WHERE id = $1`, [
		archivedDeviceId,
	]);

	// The full device carries SCD2 history: an initial info row valid through
	// 2026-03-01, then the current one — so ?at= can resolve the old state.
	await db.pool.query(
		`INSERT INTO device_info
		   (device_id, gauge_station_id, type, page_version, activation_date, warranty_end_date,
		    latitude, longitude, active, display_name, introduced, archived)
		 VALUES
		   ($1, $2, 'gauge', 'v1', '2026-01-15', '2027-01-15', 30.0, -96.0, TRUE,
		    'Legacy Logger', '2026-01-01', '2026-03-01'),
		   ($1, $2, 'gauge', 'v2', '2026-01-15', '2027-01-15', 30.6187, -96.3155, TRUE,
		    'Main Logger', '2026-03-01', NULL),
		   ($3, $4, 'camera', NULL, NULL, NULL, 30.68, -96.37, TRUE, 'Intersection Camera', '2026-01-01', NULL),
		   ($5, $4, 'gauge', NULL, NULL, NULL, 30.69, -96.38, FALSE, NULL, '2026-01-01', NULL),
		   ($6, $2, 'gauge', NULL, NULL, NULL, 30.60, -96.30, TRUE, NULL, '2026-01-01', NULL)`,
		[
			fullDeviceId,
			torresStationId,
			cameraDeviceId,
			bryanStationId,
			inactiveDeviceId,
			archivedDeviceId,
		],
	);

	// Device-reported aspects for the full device (current rows only, so ?at=
	// windows before now resolve them to null).
	await db.pool.query(`INSERT INTO device_connected (device_id, connected) VALUES ($1, TRUE)`, [
		fullDeviceId,
	]);
	await db.pool.query(
		`INSERT INTO device_networking (device_id, protocol, api_version) VALUES ($1, 'mqtt', 'v2')`,
		[fullDeviceId],
	);
	await db.pool.query(
		`INSERT INTO device_wifi_interface_active (device_id, wifi_active) VALUES ($1, TRUE)`,
		[fullDeviceId],
	);
	// float4 columns: use values exact in binary so equality assertions hold.
	await db.pool.query(
		`INSERT INTO device_power (device_id, min_voltage, max_voltage) VALUES ($1, 11.5, 14.5)`,
		[fullDeviceId],
	);
	await db.pool.query(`INSERT INTO device_datalogging (device_id, timestep) VALUES ($1, 300)`, [
		fullDeviceId,
	]);
	await db.pool.query(
		`INSERT INTO device_connection_quality (device_id, min_rssi, max_rssi) VALUES ($1, -100, -60)`,
		[fullDeviceId],
	);

	// Camera aspect rows for the camera device.
	await db.pool.query(
		`INSERT INTO device_camera_trigger_override (device_id, trigger_override) VALUES ($1, NULL)`,
		[cameraDeviceId],
	);
	await db.pool.query(
		`INSERT INTO device_camera_trigger (device_id, triggered) VALUES ($1, TRUE)`,
		[cameraDeviceId],
	);

	// Two sims; sim_index 1 is the active one.
	const sims = await db.pool.query<{ id: number; iccid: string }>(
		`INSERT INTO sim (iccid, provider)
		 VALUES ('89014103211118510700', 'hologram'), ('89014103211118510701', 'emnify')
		 RETURNING id, iccid`,
	);
	const simId = (iccid: string) =>
		must(
			sims.rows.find((s) => s.iccid === iccid),
			`sim fixture ${iccid} was not seeded`,
		).id;
	await db.pool.query(
		`INSERT INTO device_sim (device_id, sim_id, sim_index) VALUES ($1, $2, 0), ($1, $3, 1)`,
		[fullDeviceId, simId("89014103211118510700"), simId("89014103211118510701")],
	);
	await db.pool.query(
		`INSERT INTO device_sim_active (device_id, active_sim_index) VALUES ($1, 1)`,
		[fullDeviceId],
	);

	// Risk monitors: one range-based (value 15 falls in the [10, 20] → 2 band)
	// at priority 1, one gradient-based (value 50 across 0..100 → risk 0..5
	// interpolates to 2.5) at priority 2. The device risk level follows the
	// highest-priority (lowest number) config → 2.
	const channels = await db.pool.query<{ id: number; local_id: number }>(
		`INSERT INTO channel (device_id, local_id, channel_type_id) VALUES ($1, 0, 1), ($1, 1, 1)
		 RETURNING id, local_id`,
		[fullDeviceId],
	);
	channelRangeId = must(
		channels.rows.find((c) => c.local_id === 0),
		"range channel fixture was not seeded",
	).id;
	channelGradientId = must(
		channels.rows.find((c) => c.local_id === 1),
		"gradient channel fixture was not seeded",
	).id;

	const monitors = await db.pool.query<{ id: number; local_id: number }>(
		`INSERT INTO risk_level_monitor (device_id, local_id, type_id) VALUES ($1, 0, 1), ($1, 1, 1)
		 RETURNING id, local_id`,
		[fullDeviceId],
	);
	rangeMonitorId = must(
		monitors.rows.find((m) => m.local_id === 0),
		"range monitor fixture was not seeded",
	).id;
	gradientMonitorId = must(
		monitors.rows.find((m) => m.local_id === 1),
		"gradient monitor fixture was not seeded",
	).id;

	await db.pool.query(
		`INSERT INTO risk_level_monitor_config (risk_level_monitor_id, priority) VALUES ($1, 1), ($2, 2)`,
		[rangeMonitorId, gradientMonitorId],
	);
	await db.pool.query(
		`INSERT INTO risk_level_monitor_channel (risk_level_monitor_id, channel_id) VALUES ($1, $2), ($3, $4)`,
		[rangeMonitorId, channelRangeId, gradientMonitorId, channelGradientId],
	);
	await db.pool.query(
		`INSERT INTO risk_level_monitor_config_range (risk_level_monitor_id, min_value, max_value, risk_level)
		 VALUES ($1, 0, 10, 1), ($1, 10, 20, 2)`,
		[rangeMonitorId],
	);
	await db.pool.query(
		`INSERT INTO risk_level_monitor_config_gradient
		   (risk_level_monitor_id, begin_value, end_value, begin_risk_level, end_risk_level)
		 VALUES ($1, 0, 100, 0, 5)`,
		[gradientMonitorId],
	);
	// The insert trigger on measurement_record maintains measurement_record_latest.
	await db.pool.query(
		`INSERT INTO measurement_record (date, channel_id, value) VALUES (NOW(), $1, 15), (NOW(), $2, 50)`,
		[channelRangeId, channelGradientId],
	);

	// A device exercising priority semantics across four monitors:
	//   priority 0 — no measurement, so no computable risk (skipped)
	//   priority 1 — risk 1 and risk 3 (tie → most significant value wins)
	//   priority 2 — risk 4 (would win under a plain MAX, must lose here)
	// Expected device risk level: 3.
	const priorityDevice = await db.pool.query<{ id: number }>(
		`INSERT INTO device (serial_number, introduced)
		 VALUES ('devices-test-priority', '2026-01-01') RETURNING id`,
	);
	priorityDeviceId = must(priorityDevice.rows[0], "priority device fixture was not seeded").id;
	await db.pool.query(
		`INSERT INTO device_info (device_id, gauge_station_id, type, latitude, longitude, active, display_name)
		 VALUES ($1, $2, 'gauge', 30.62, -96.32, TRUE, 'Priority Logger')`,
		[priorityDeviceId, torresStationId],
	);
	const priorityChannels = await db.pool.query<{ id: number; local_id: number }>(
		`INSERT INTO channel (device_id, local_id, channel_type_id)
		 VALUES ($1, 0, 1), ($1, 1, 1), ($1, 2, 1), ($1, 3, 1)
		 RETURNING id, local_id`,
		[priorityDeviceId],
	);
	const priorityChannelId = (localId: number) =>
		must(
			priorityChannels.rows.find((c) => c.local_id === localId),
			`priority channel fixture ${localId} was not seeded`,
		).id;
	const priorityMonitors = await db.pool.query<{ id: number; local_id: number }>(
		`INSERT INTO risk_level_monitor (device_id, local_id, type_id)
		 VALUES ($1, 0, 1), ($1, 1, 1), ($1, 2, 1), ($1, 3, 1)
		 RETURNING id, local_id`,
		[priorityDeviceId],
	);
	const priorityMonitorId = (localId: number) =>
		must(
			priorityMonitors.rows.find((m) => m.local_id === localId),
			`priority monitor fixture ${localId} was not seeded`,
		).id;
	await db.pool.query(
		`INSERT INTO risk_level_monitor_config (risk_level_monitor_id, priority)
		 VALUES ($1, 0), ($2, 1), ($3, 1), ($4, 2)`,
		[priorityMonitorId(0), priorityMonitorId(1), priorityMonitorId(2), priorityMonitorId(3)],
	);
	await db.pool.query(
		`INSERT INTO risk_level_monitor_channel (risk_level_monitor_id, channel_id)
		 VALUES ($1, $2), ($3, $4), ($5, $6), ($7, $8)`,
		[
			priorityMonitorId(0),
			priorityChannelId(0),
			priorityMonitorId(1),
			priorityChannelId(1),
			priorityMonitorId(2),
			priorityChannelId(2),
			priorityMonitorId(3),
			priorityChannelId(3),
		],
	);
	await db.pool.query(
		`INSERT INTO risk_level_monitor_config_range (risk_level_monitor_id, min_value, max_value, risk_level)
		 VALUES ($1, 0, 10, 4), ($2, 0, 10, 1), ($3, 0, 10, 3), ($4, 0, 10, 4)`,
		[priorityMonitorId(0), priorityMonitorId(1), priorityMonitorId(2), priorityMonitorId(3)],
	);
	// No measurement on channel 0 — its priority-0 monitor yields no risk.
	await db.pool.query(
		`INSERT INTO measurement_record (date, channel_id, value)
		 VALUES (NOW(), $1, 5), (NOW(), $2, 5), (NOW(), $3, 5)`,
		[priorityChannelId(1), priorityChannelId(2), priorityChannelId(3)],
	);
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

interface DeviceSummaryBody {
	id: number;
	serialNumber: string;
	type: string;
	gaugeStationId: number;
	latitude: number | null;
	longitude: number | null;
	active: boolean | null;
	connected: boolean | null;
	riskLevel: number | null;
	riskLevelOverride: number | null;
	riskLevelConfigRanges: {
		minValue: number | null;
		maxValue: number | null;
		riskLevel: number;
		category: string | null;
	}[];
	displayName: string | null;
}

interface DeviceDetailBody extends DeviceSummaryBody {
	pageVersion: string | null;
	activationDate: string | null;
	warrantyEndDate: string | null;
	introduced: string;
	archived: string | null;
	networking: { protocol: string; apiVersion: string } | null;
	wifiActive: boolean | null;
	power: { minVoltage: number; maxVoltage: number } | null;
	datalogging: { timestep: number } | null;
	connectionQuality: {
		minRssi: number | null;
		maxRssi: number | null;
		minRsrp: number | null;
		maxRsrp: number | null;
		minRsrq: number | null;
		maxRsrq: number | null;
	} | null;
	camera: { triggerOverride: boolean | null; triggered: boolean | null } | null;
	sims: {
		simId: number;
		iccid: string;
		provider: string;
		simIndex: number | null;
		isActive: boolean;
	}[];
	riskLevels: {
		monitorId: number;
		channelId: number;
		priority: number;
		measurementDate: string | null;
		value: number | null;
		riskLevel: number | null;
	}[];
}

interface DeviceListBody {
	data: DeviceSummaryBody[];
}

const listIds = (body: DeviceListBody) => body.data.map((device) => device.id);

test("GET /v1/devices returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/devices" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/devices returns the summary shape with the computed risk level", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/devices",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceListBody>();
	const full = must(
		body.data.find((device) => device.id === fullDeviceId),
		"full device was not returned",
	);
	expect(full).toEqual({
		id: fullDeviceId,
		serialNumber: "devices-test-full",
		type: "gauge",
		gaugeStationId: torresStationId,
		latitude: 30.6187,
		longitude: -96.3155,
		active: true,
		connected: true,
		riskLevel: 2,
		riskLevelOverride: null,
		// Every band of the winning (range) monitor, ordered by min_value.
		riskLevelConfigRanges: [
			{ minValue: 0, maxValue: 10, riskLevel: 1, category: null },
			{ minValue: 10, maxValue: 20, riskLevel: 2, category: null },
		],
		displayName: "Main Logger",
	});

	// No monitors and no connected row → nulls, not fabricated values.
	const camera = must(
		body.data.find((device) => device.id === cameraDeviceId),
		"camera device was not returned",
	);
	expect(camera.connected).toBeNull();
	expect(camera.riskLevel).toBeNull();
	expect(camera.riskLevelConfigRanges).toEqual([]);
});

test("GET /v1/devices limits session users to their client's devices", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/devices",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = listIds(res.json<DeviceListBody>());
	expect(ids).toContain(cameraDeviceId);
	expect(ids).toContain(inactiveDeviceId); // manager holds W_CLIENT_DEVICES
	expect(ids).not.toContain(fullDeviceId);
});

test("GET /v1/devices hides inactive devices from read-only users", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/devices",
		headers: { cookie: readOnly.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = listIds(res.json<DeviceListBody>());
	expect(ids).toContain(cameraDeviceId);
	expect(ids).not.toContain(inactiveDeviceId);
});

test("GET /v1/devices?active=false rejects read-only users", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/devices?active=false",
		headers: { cookie: readOnly.cookie },
	});

	expect(res.statusCode).toBe(403);
});

test("GET /v1/devices?active=false shows writers only inactive devices", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/devices?active=false",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = listIds(res.json<DeviceListBody>());
	expect(ids).toContain(inactiveDeviceId);
	expect(ids).not.toContain(fullDeviceId);
	expect(ids).not.toContain(cameraDeviceId);
});

test("GET /v1/devices?type= filters by device type", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/devices?type=camera",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = listIds(res.json<DeviceListBody>());
	expect(ids).toContain(cameraDeviceId);
	expect(ids).not.toContain(fullDeviceId);
});

test("GET /v1/devices?gaugeStationId= filters by station", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices?gaugeStationId=${bryanStationId}`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = listIds(res.json<DeviceListBody>());
	expect(ids).toContain(cameraDeviceId);
	expect(ids).toContain(inactiveDeviceId);
	expect(ids).not.toContain(fullDeviceId);
});

test("GET /v1/devices?connected= treats never-reported devices as disconnected", async () => {
	const connectedRes = await app.inject({
		method: "GET",
		url: "/v1/devices?connected=true",
		headers: { cookie: admin.cookie },
	});
	expect(connectedRes.statusCode).toBe(200);
	const connectedIds = listIds(connectedRes.json<DeviceListBody>());
	expect(connectedIds).toContain(fullDeviceId);
	expect(connectedIds).not.toContain(cameraDeviceId);

	const disconnectedRes = await app.inject({
		method: "GET",
		url: "/v1/devices?connected=false",
		headers: { cookie: admin.cookie },
	});
	expect(disconnectedRes.statusCode).toBe(200);
	const disconnectedIds = listIds(disconnectedRes.json<DeviceListBody>());
	expect(disconnectedIds).toContain(cameraDeviceId);
	expect(disconnectedIds).not.toContain(fullDeviceId);
});

test("GET /v1/devices hides archived devices unless includeArchived is set", async () => {
	const defaultRes = await app.inject({
		method: "GET",
		url: "/v1/devices",
		headers: { cookie: admin.cookie },
	});
	expect(listIds(defaultRes.json<DeviceListBody>())).not.toContain(archivedDeviceId);

	const archivedRes = await app.inject({
		method: "GET",
		url: "/v1/devices?includeArchived=true",
		headers: { cookie: admin.cookie },
	});
	expect(listIds(archivedRes.json<DeviceListBody>())).toContain(archivedDeviceId);
});

test("GET /v1/devices/:id returns the full detail shape", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDetailBody>();
	expect(body).toEqual(
		expect.objectContaining({
			id: fullDeviceId,
			serialNumber: "devices-test-full",
			type: "gauge",
			gaugeStationId: torresStationId,
			latitude: 30.6187,
			longitude: -96.3155,
			active: true,
			connected: true,
			riskLevel: 2,
			riskLevelConfigRanges: [
				{ minValue: 0, maxValue: 10, riskLevel: 1, category: null },
				{ minValue: 10, maxValue: 20, riskLevel: 2, category: null },
			],
			displayName: "Main Logger",
			pageVersion: "v2",
			activationDate: "2026-01-15T00:00:00.000Z",
			warrantyEndDate: "2027-01-15T00:00:00.000Z",
			archived: null,
			networking: { protocol: "mqtt", apiVersion: "v2" },
			wifiActive: true,
			power: { minVoltage: 11.5, maxVoltage: 14.5 },
			datalogging: { timestep: 300 },
			connectionQuality: {
				minRssi: -100,
				maxRssi: -60,
				minRsrp: null,
				maxRsrp: null,
				minRsrq: null,
				maxRsrq: null,
			},
			camera: null,
		}),
	);
	expect(new Date(body.introduced).getTime()).not.toBeNaN();

	expect(body.sims).toEqual([
		{
			simId: expect.any(Number),
			iccid: "89014103211118510700",
			provider: "hologram",
			simIndex: 0,
			isActive: false,
		},
		{
			simId: expect.any(Number),
			iccid: "89014103211118510701",
			provider: "emnify",
			simIndex: 1,
			isActive: true,
		},
	]);

	expect(body.riskLevels).toEqual([
		{
			monitorId: rangeMonitorId,
			channelId: channelRangeId,
			priority: 1,
			measurementDate: expect.any(String),
			value: 15,
			riskLevel: 2,
		},
		{
			monitorId: gradientMonitorId,
			channelId: channelGradientId,
			priority: 2,
			measurementDate: expect.any(String),
			value: 50,
			riskLevel: 2.5,
		},
	]);
});

test("device risk level follows monitor config priority, not the overall max", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${priorityDeviceId}`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDetailBody>();
	// The priority-0 monitor has no measurement so it cannot produce a risk and
	// is skipped. The two priority-1 monitors tie (risks 1 and 3) and the most
	// significant value wins. The priority-2 monitor's risk of 4 — the overall
	// max — must not be used.
	expect(body.riskLevel).toBe(3);
	// The ranges union every active monitor's bands, deduplicated — the two
	// identical risk-4 bands collapse to one — and ordered by min value then
	// risk level, regardless of which monitor produced the device risk.
	expect(body.riskLevelConfigRanges).toEqual([
		{ minValue: 0, maxValue: 10, riskLevel: 1, category: null },
		{ minValue: 0, maxValue: 10, riskLevel: 3, category: null },
		{ minValue: 0, maxValue: 10, riskLevel: 4, category: null },
	]);
	// The per-monitor breakdown is ordered by priority.
	expect(body.riskLevels.map((r) => r.priority)).toEqual([0, 1, 1, 2]);
});

test("GET /v1/devices/:id returns the camera aspect for camera devices", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${cameraDeviceId}`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDetailBody>();
	expect(body.camera).toEqual({ triggerOverride: null, triggered: true });
	expect(body.networking).toBeNull();
	expect(body.power).toBeNull();
	expect(body.sims).toEqual([]);
	expect(body.riskLevels).toEqual([]);
});

test("GET /v1/devices/:id hides another client's device from session users", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("GET /v1/devices/:id hides inactive devices from read-only users", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${inactiveDeviceId}`,
		headers: { cookie: readOnly.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("GET /v1/devices/:id?at= resolves SCD2 state as of that instant", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/devices/${fullDeviceId}?at=${encodeURIComponent("2026-02-01T00:00:00Z")}`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDetailBody>();
	// The initial info row was valid through 2026-03-01.
	expect(body.latitude).toBe(30.0);
	expect(body.longitude).toBe(-96.0);
	expect(body.pageVersion).toBe("v1");
	expect(body.displayName).toBe("Legacy Logger");
	// Aspect rows were introduced "now" (test run time), which is after the
	// requested instant — so every aspect resolves to null.
	expect(body.connected).toBeNull();
	expect(body.networking).toBeNull();
	expect(body.wifiActive).toBeNull();
	expect(body.power).toBeNull();
	expect(body.sims).toEqual([]);
	// Historical risk is intentionally not computed from latest values.
	expect(body.riskLevel).toBeNull();
	expect(body.riskLevels).toEqual([]);
	expect(body.riskLevelConfigRanges).toEqual([]);
});

test("PATCH /v1/devices/:id rejects read-only users", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${cameraDeviceId}`,
		headers: { cookie: readOnly.cookie },
		body: { info: { latitude: 30.7 } },
	});

	expect(res.statusCode).toBe(403);
});

test("PATCH /v1/devices/:id hides another client's device from client writers", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: clientManager.cookie },
		body: { info: { latitude: 30.7 } },
	});

	expect(res.statusCode).toBe(404);
});

test("PATCH /v1/devices/:id rejects an unknown gauge station", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: admin.cookie },
		body: { info: { gaugeStationId: 999999 } },
	});

	expect(res.statusCode).toBe(400);
});

test("PATCH /v1/devices/:id rejects moving a device to another client's station", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${cameraDeviceId}`,
		headers: { cookie: clientManager.cookie },
		body: { info: { gaugeStationId: torresStationId } },
	});

	expect(res.statusCode).toBe(403);
});

test("PATCH /v1/devices/:id updates info as a new SCD row, merging with current", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: admin.cookie },
		body: { info: { latitude: 30.9, pageVersion: "v3", displayName: "North Logger" } },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDetailBody>();
	expect(body.latitude).toBe(30.9);
	expect(body.pageVersion).toBe("v3");
	expect(body.displayName).toBe("North Logger");
	// Untouched info fields carry over from the current row.
	expect(body.longitude).toBe(-96.3155);
	expect(body.activationDate).toBe("2026-01-15T00:00:00.000Z");

	// SCD Type 2: the previous info row is archived, not overwritten.
	const rows = await db.pool.query<{
		page_version: string | null;
		display_name: string | null;
		archived: Date | null;
	}>(
		`SELECT page_version, display_name, archived FROM device_info WHERE device_id = $1 ORDER BY id`,
		[fullDeviceId],
	);
	expect(rows.rows).toHaveLength(3);
	const previousInfo = must(rows.rows[1], "previous info row was not returned");
	const currentInfo = must(rows.rows[2], "current info row was not returned");
	expect(previousInfo.page_version).toBe("v2");
	expect(previousInfo.display_name).toBe("Main Logger");
	expect(previousInfo.archived).not.toBeNull();
	expect(currentInfo.page_version).toBe("v3");
	expect(currentInfo.display_name).toBe("North Logger");
	expect(currentInfo.archived).toBeNull();
});

test("PATCH /v1/devices/:id can clear displayName", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: admin.cookie },
		body: { info: { displayName: null } },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<DeviceDetailBody>().displayName).toBeNull();
});

test("PATCH /v1/devices/:id replaces power as a new SCD row", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: admin.cookie },
		body: { power: { minVoltage: 11, maxVoltage: 15 } },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<DeviceDetailBody>().power).toEqual({ minVoltage: 11, maxVoltage: 15 });

	const rows = await db.pool.query<{ min_voltage: number; archived: Date | null }>(
		`SELECT min_voltage, archived FROM device_power WHERE device_id = $1 ORDER BY id`,
		[fullDeviceId],
	);
	expect(rows.rows).toHaveLength(2);
	const previousPower = must(rows.rows[0], "previous power row was not returned");
	const currentPower = must(rows.rows[1], "current power row was not returned");
	expect(previousPower.min_voltage).toBe(11.5);
	expect(previousPower.archived).not.toBeNull();
	expect(currentPower.min_voltage).toBe(11);
	expect(currentPower.archived).toBeNull();
});

const controlAuditActions = async (deviceId: number) =>
	(
		await db.pool.query<{ action_id: string }>(
			`SELECT audit_log_action.action_id FROM control_audit_log
			 JOIN audit_log_action ON audit_log_action.id = control_audit_log.log_action_id
			 WHERE control_audit_log.device_id = $1 ORDER BY control_audit_log.id`,
			[deviceId],
		)
	).rows.map((row) => row.action_id);

test("PATCH /v1/devices/:id sets a manual risk level override that trumps the computed risk", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: admin.cookie },
		body: { riskLevelOverride: 4 },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDetailBody>();
	expect(body.riskLevel).toBe(4);
	expect(body.riskLevelOverride).toBe(4);
	// The per-monitor breakdown still reports the computed values.
	expect(body.riskLevels.map((r) => r.riskLevel)).toEqual([2, 2.5]);

	// The list view resolves the override too.
	const listRes = await app.inject({
		method: "GET",
		url: "/v1/devices",
		headers: { cookie: admin.cookie },
	});
	const listed = must(
		listRes.json<DeviceListBody>().data.find((device) => device.id === fullDeviceId),
		"full device was not returned",
	);
	expect(listed.riskLevel).toBe(4);
	expect(listed.riskLevelOverride).toBe(4);

	expect(await controlAuditActions(fullDeviceId)).toEqual(["MAN_OVERTOP_ON"]);
});

test("PATCH /v1/devices/:id replaces an existing override as a new SCD row", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: admin.cookie },
		body: { riskLevelOverride: 3 },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDetailBody>();
	expect(body.riskLevel).toBe(3);
	expect(body.riskLevelOverride).toBe(3);

	const rows = await db.pool.query<{ risk_level: number; archived: Date | null }>(
		`SELECT risk_level, archived FROM risk_level_monitor_config_override
		 WHERE device_id = $1 ORDER BY id`,
		[fullDeviceId],
	);
	expect(rows.rows).toHaveLength(2);
	const previousOverride = must(rows.rows[0], "previous override row was not returned");
	const currentOverride = must(rows.rows[1], "current override row was not returned");
	expect(previousOverride.risk_level).toBe(4);
	expect(previousOverride.archived).not.toBeNull();
	expect(currentOverride.risk_level).toBe(3);
	expect(currentOverride.archived).toBeNull();

	expect(await controlAuditActions(fullDeviceId)).toEqual(["MAN_OVERTOP_ON", "MAN_OVERTOP_ON"]);
});

test("PATCH /v1/devices/:id clears the override and returns to the computed risk", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: admin.cookie },
		body: { riskLevelOverride: null },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeviceDetailBody>();
	expect(body.riskLevel).toBe(2);
	expect(body.riskLevelOverride).toBeNull();

	expect(await controlAuditActions(fullDeviceId)).toEqual([
		"MAN_OVERTOP_ON",
		"MAN_OVERTOP_ON",
		"MAN_OVERTOP_OFF",
	]);
});

test("PATCH /v1/devices/:id clearing with no active override is a no-op", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: admin.cookie },
		body: { riskLevelOverride: null },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<DeviceDetailBody>().riskLevelOverride).toBeNull();

	// No new override rows and no MAN_OVERTOP_OFF audit entry for a no-op clear.
	const rows = await db.pool.query<{ count: string }>(
		`SELECT COUNT(*) AS count FROM risk_level_monitor_config_override WHERE device_id = $1`,
		[fullDeviceId],
	);
	expect(must(rows.rows[0], "override count was not returned").count).toBe("2");
	expect(await controlAuditActions(fullDeviceId)).toEqual([
		"MAN_OVERTOP_ON",
		"MAN_OVERTOP_ON",
		"MAN_OVERTOP_OFF",
	]);
});

test("PATCH /v1/devices/:id rejects an out-of-range override", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/devices/${fullDeviceId}`,
		headers: { cookie: admin.cookie },
		body: { riskLevelOverride: 5 },
	});

	expect(res.statusCode).toBe(400);
});
