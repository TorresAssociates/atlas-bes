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
let externalReader: TestUserSession;
let torresStationId: number;
let bryanStationId: number;
let bryanInactiveId: number;
let createdGaugeStationId: number;

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "gaugeStations-admin@example.com",
		name: "GaugeStations Admin",
		client_id: 1,
		role_id: 1,
	});
	clientManager = await signUpTestUser(app, {
		email: "gaugeStations-manager@example.com",
		name: "GaugeStations Manager",
		client_id: 2,
		role_id: 3,
	});

	// The seed has no role with device read but not write, so build the two
	// permission mixes the ?active=false gating needs: a plain client-scoped
	// reader, and an external reader whose only write perm is client-scoped
	// (the wrong scope, so it must not unlock inactive gaugeStations).
	const readOnlyRole = await db.pool.query<{ id: number }>(
		`INSERT INTO role (client_id, name) VALUES (2, 'GAUGESTATIONS_READ_ONLY') RETURNING id`,
	);
	await db.pool.query(`INSERT INTO role_permission (role_id, permission_id) VALUES ($1, 1)`, [
		readOnlyRole.rows[0]!.id,
	]);
	readOnly = await signUpTestUser(app, {
		email: "gaugeStations-read-only@example.com",
		name: "GaugeStations Read Only",
		client_id: 2,
		role_id: readOnlyRole.rows[0]!.id,
	});

	const externalReaderRole = await db.pool.query<{ id: number }>(
		`INSERT INTO role (client_id, name) VALUES (2, 'GAUGESTATIONS_EXTERNAL_READER') RETURNING id`,
	);
	await db.pool.query(
		`INSERT INTO role_permission (role_id, permission_id) VALUES ($1, 3), ($1, 2)`,
		[externalReaderRole.rows[0]!.id],
	);
	externalReader = await signUpTestUser(app, {
		email: "gaugeStations-external-reader@example.com",
		name: "GaugeStations External Reader",
		client_id: 2,
		role_id: externalReaderRole.rows[0]!.id,
	});

	const stations = await db.pool.query<{ id: number; name: string }>(
		`INSERT INTO gauge_station (name)
		 VALUES ('GS-test-torres'), ('GS-test-bryan'), ('GS-test-bryan-inactive')
		 RETURNING id, name`,
	);
	torresStationId = stations.rows.find((s) => s.name === "GS-test-torres")!.id;
	bryanStationId = stations.rows.find((s) => s.name === "GS-test-bryan")!.id;
	bryanInactiveId = stations.rows.find((s) => s.name === "GS-test-bryan-inactive")!.id;

	await db.pool.query(
		`INSERT INTO gauge_station_info (gauge_station_id, city_id, location, latitude, longitude, publicly_visible, active)
		 VALUES ($1, 1, 'Wolf Pen Creek', 30.6187, -96.3155, TRUE, FALSE),
		        ($2, 2, 'Carter Creek', 30.6744, -96.3698, FALSE, TRUE),
		        ($3, 2, 'Still Creek', 30.6912, -96.4021, TRUE, FALSE)`,
		[torresStationId, bryanStationId, bryanInactiveId],
	);
	await db.pool.query(
		`INSERT INTO client_gauge_station (gauge_station_id, client_id)
		 VALUES ($1, 1), ($2, 2), ($3, 2)`,
		[torresStationId, bryanStationId, bryanInactiveId],
	);

	// Risk fixtures for GET /v1/gauge-stations/geojson. A range monitor whose latest
	// measurement lands in a band is the simplest computable risk, so every
	// device here uses one:
	//   bryan station — device A computes risk 2; device B computes risk 4 but
	//     carries a manual override of 1, so its effective risk is 1. The
	//     override applies per device BEFORE the max, so bryan = MAX(2, 1) = 2
	//     (B's override must not mask A, and B's computed 4 must not leak out).
	//     An archived device with a risk-9 override must not count at all.
	//   torres station — one device computing risk 2 with an override of 5;
	//     the override wins, torres = 5.
	//   bryan inactive station — no devices, risk NULL.
	const riskDevices = await db.pool.query<{ id: number; serial_number: string }>(
		`INSERT INTO device (serial_number, introduced)
		 VALUES ('gauge-test-risk-a', '2026-01-01'), ('gauge-test-risk-b', '2026-01-01'),
		        ('gauge-test-risk-archived', '2026-01-01'), ('gauge-test-risk-torres', '2026-01-01')
		 RETURNING id, serial_number`,
	);
	const riskDeviceId = (serial: string) => {
		const device = riskDevices.rows.find((row) => row.serial_number === serial);
		if (!device) throw new Error(`device fixture ${serial} was not seeded`);
		return device.id;
	};
	const deviceA = riskDeviceId("gauge-test-risk-a");
	const deviceB = riskDeviceId("gauge-test-risk-b");
	const deviceArchived = riskDeviceId("gauge-test-risk-archived");
	const deviceTorres = riskDeviceId("gauge-test-risk-torres");
	await db.pool.query(`UPDATE device SET archived = '2026-06-01' WHERE id = $1`, [
		deviceArchived,
	]);
	await db.pool.query(
		`INSERT INTO device_info (device_id, gauge_station_id, type, latitude, longitude, active)
		 VALUES ($1, $5, 'gauge', 30.67, -96.37, TRUE),
		        ($2, $5, 'gauge', 30.68, -96.37, TRUE),
		        ($3, $5, 'gauge', 30.69, -96.37, TRUE),
		        ($4, $6, 'gauge', 30.62, -96.32, TRUE)`,
		[deviceA, deviceB, deviceArchived, deviceTorres, bryanStationId, torresStationId],
	);

	const seedRangeRisk = async (deviceId: number, riskLevel: number, value: number) => {
		const channel = await db.pool.query<{ id: number }>(
			`INSERT INTO channel (device_id, local_id, channel_type_id) VALUES ($1, 0, 1) RETURNING id`,
			[deviceId],
		);
		const monitor = await db.pool.query<{ id: number }>(
			`INSERT INTO risk_level_monitor (device_id, local_id, type_id) VALUES ($1, 0, 1) RETURNING id`,
			[deviceId],
		);
		await db.pool.query(
			`INSERT INTO risk_level_monitor_config (risk_level_monitor_id, priority) VALUES ($1, 1)`,
			[monitor.rows[0]!.id],
		);
		await db.pool.query(
			`INSERT INTO risk_level_monitor_channel (risk_level_monitor_id, channel_id) VALUES ($1, $2)`,
			[monitor.rows[0]!.id, channel.rows[0]!.id],
		);
		await db.pool.query(
			`INSERT INTO risk_level_monitor_config_range (risk_level_monitor_id, min_value, max_value, risk_level)
			 VALUES ($1, 0, 100, $2)`,
			[monitor.rows[0]!.id, riskLevel],
		);
		// The insert trigger on measurement_record maintains measurement_record_latest.
		await db.pool.query(
			`INSERT INTO measurement_record (date, channel_id, value) VALUES (NOW(), $1, $2)`,
			[channel.rows[0]!.id, value],
		);
	};
	await seedRangeRisk(deviceA, 2, 15);
	await seedRangeRisk(deviceB, 4, 5);
	await seedRangeRisk(deviceTorres, 2, 5);
	await db.pool.query(
		`INSERT INTO risk_level_monitor_config_override (device_id, risk_level)
		 VALUES ($1, 1), ($2, 5), ($3, 9)`,
		[deviceB, deviceTorres, deviceArchived],
	);
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

interface GaugeStationBody {
	id: number;
	name: string;
	introduced: string;
	archived: string | null;
	city: { id: number; state: string; name: string };
	clients: { id: number; name: string }[];
	location: string;
	latitude: number;
	longitude: number;
	publiclyVisible: boolean;
	active: boolean;
}

interface GaugeStationListBody {
	data: GaugeStationBody[];
}

interface GaugeStationFeatureBody {
	type: "Feature";
	id: number;
	geometry: { type: "Point"; coordinates: [number, number] };
	properties: Omit<GaugeStationBody, "id" | "latitude" | "longitude"> & {
		riskLevel: number | null;
	};
}

interface GaugeStationFeatureCollectionBody {
	type: "FeatureCollection";
	features: GaugeStationFeatureBody[];
}

test("GET /v1/gauge-stations/geojson returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/gauge-stations/geojson" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/gauge-stations/geojson returns features with gaugeStation risk levels", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations/geojson",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<GaugeStationFeatureCollectionBody>();
	expect(body.type).toBe("FeatureCollection");

	// Device B's override (1) applies before the max, so it neither masks
	// device A's computed 2 nor lets B's computed 4 through; the archived
	// device's risk-9 override is ignored entirely.
	const bryan = body.features.find((feature) => feature.id === bryanStationId)!;
	expect(bryan).toEqual({
		type: "Feature",
		id: bryanStationId,
		geometry: { type: "Point", coordinates: [-96.3698, 30.6744] },
		properties: expect.objectContaining({
			name: "GS-test-bryan",
			archived: null,
			city: { id: 2, state: "TX", name: "Bryan" },
			clients: [{ id: 2, name: "City of Bryan" }],
			location: "Carter Creek",
			publiclyVisible: false,
			active: true,
			riskLevel: 2,
		}),
	});

	// The torres device's manual override (5) beats its computed risk (2).
	const torres = body.features.find((feature) => feature.id === torresStationId)!;
	expect(torres.properties.riskLevel).toBe(5);

	// No devices → no risk level.
	const inactive = body.features.find((feature) => feature.id === bryanInactiveId)!;
	expect(inactive.properties.riskLevel).toBeNull();
});

test("GET /v1/gauge-stations/geojson limits session users to their client's gaugeStations", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations/geojson",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = res.json<GaugeStationFeatureCollectionBody>().features.map((feature) => feature.id);
	expect(ids).toContain(bryanStationId);
	expect(ids).not.toContain(torresStationId);
});

test("GET /v1/gauge-stations/geojson hides inactive gaugeStations from read-only users", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations/geojson",
		headers: { cookie: readOnly.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = res.json<GaugeStationFeatureCollectionBody>().features.map((feature) => feature.id);
	expect(ids).toContain(bryanStationId);
	expect(ids).not.toContain(bryanInactiveId);
});

test("GET /v1/gauge-stations/geojson?active=false rejects read-only users", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations/geojson?active=false",
		headers: { cookie: readOnly.cookie },
	});

	expect(res.statusCode).toBe(403);
});

test("GET /v1/gauge-stations returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/gauge-stations" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/gauge-stations lets admins see all gaugeStations with the full shape", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<GaugeStationListBody>();
	expect(body.data.map((gaugeStation) => gaugeStation.id)).toEqual(
		expect.arrayContaining([torresStationId, bryanStationId]),
	);

	const bryan = body.data.find((gaugeStation) => gaugeStation.id === bryanStationId)!;
	expect(bryan).toEqual(
		expect.objectContaining({
			name: "GS-test-bryan",
			archived: null,
			city: { id: 2, state: "TX", name: "Bryan" },
			clients: [{ id: 2, name: "City of Bryan" }],
			location: "Carter Creek",
			latitude: 30.6744,
			longitude: -96.3698,
			publiclyVisible: false,
			active: true,
		}),
	);
	expect(new Date(bryan.introduced).getTime()).not.toBeNaN();

	const torres = body.data.find((gaugeStation) => gaugeStation.id === torresStationId)!;
	expect(torres.active).toBe(false);
});

test("GET /v1/gauge-stations?active=false lets writers see only inactive gaugeStations", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations?active=false",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = res.json<GaugeStationListBody>().data.map((gaugeStation) => gaugeStation.id);
	expect(ids).toContain(torresStationId);
	expect(ids).toContain(bryanInactiveId);
	expect(ids).not.toContain(bryanStationId);
});

test("GET /v1/gauge-stations?active=false scopes client writers to their own inactive gaugeStations", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations?active=false",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = res.json<GaugeStationListBody>().data.map((gaugeStation) => gaugeStation.id);
	expect(ids).toContain(bryanInactiveId);
	expect(ids).not.toContain(torresStationId);
});

test("GET /v1/gauge-stations?active=false rejects read-only users", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations?active=false",
		headers: { cookie: readOnly.cookie },
	});

	expect(res.statusCode).toBe(403);
});

test("GET /v1/gauge-stations hides inactive gaugeStations from read-only users by default", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations",
		headers: { cookie: readOnly.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = res.json<GaugeStationListBody>().data.map((gaugeStation) => gaugeStation.id);
	expect(ids).toContain(bryanStationId);
	expect(ids).not.toContain(bryanInactiveId);
});

test("GET /v1/gauge-stations?active=false requires the write perm matching the read scope", async () => {
	// externalReader reads externally (R_EXTERNAL_DEVICES) but only holds
	// W_CLIENT_DEVICES — the wrong scope, so inactive gaugeStations stay off limits.
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations?active=false",
		headers: { cookie: externalReader.cookie },
	});

	expect(res.statusCode).toBe(403);
});

test("GET /v1/gauge-stations/:id hides inactive gaugeStations from read-only users", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/gauge-stations/${bryanInactiveId}`,
		headers: { cookie: readOnly.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("GET /v1/gauge-stations/:id shows inactive gaugeStations to client writers", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/gauge-stations/${bryanInactiveId}`,
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<GaugeStationBody>().active).toBe(false);
});

test("GET /v1/gauge-stations limits session users to their client's gaugeStations", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<GaugeStationListBody>();
	expect(body.data.map((gaugeStation) => gaugeStation.id)).toContain(bryanStationId);
	expect(body.data.map((gaugeStation) => gaugeStation.id)).not.toContain(torresStationId);
});

test("GET /v1/gauge-stations?cityId filters by city", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/gauge-stations?cityId=1",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<GaugeStationListBody>();
	expect(body.data.map((gaugeStation) => gaugeStation.id)).toContain(torresStationId);
	expect(body.data.map((gaugeStation) => gaugeStation.id)).not.toContain(bryanStationId);
});

test("GET /v1/gauge-stations/:id hides another client's gaugeStation from session users", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/gauge-stations/${torresStationId}`,
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("POST /v1/gauge-stations lets admins create a gaugeStation for any client", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/gauge-stations",
		headers: { cookie: admin.cookie },
		body: {
			name: "GS-test-created",
			clientId: 2,
			cityId: 2,
			location: "Burton Creek",
			latitude: 30.6689,
			longitude: -96.3344,
		},
	});

	expect(res.statusCode).toBe(201);
	const body = res.json<GaugeStationBody>();
	expect(body).toEqual(
		expect.objectContaining({
			name: "GS-test-created",
			archived: null,
			city: { id: 2, state: "TX", name: "Bryan" },
			clients: [{ id: 2, name: "City of Bryan" }],
			location: "Burton Creek",
			publiclyVisible: true,
			active: true,
		}),
	);
	createdGaugeStationId = body.id;
});

test("POST /v1/gauge-stations rejects client users creating for another client", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/gauge-stations",
		headers: { cookie: clientManager.cookie },
		body: {
			name: "GS-test-cross-client",
			clientId: 1,
			cityId: 1,
			location: "Somewhere",
			latitude: 30.6,
			longitude: -96.3,
		},
	});

	expect(res.statusCode).toBe(403);
});

test("POST /v1/gauge-stations lets client users create for their own client", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/gauge-stations",
		headers: { cookie: clientManager.cookie },
		body: {
			name: "GS-test-own-client",
			clientId: 2,
			cityId: 2,
			location: "Turkey Creek",
			latitude: 30.65,
			longitude: -96.4,
			publiclyVisible: false,
		},
	});

	expect(res.statusCode).toBe(201);
	const body = res.json<GaugeStationBody>();
	expect(body.clients).toEqual([{ id: 2, name: "City of Bryan" }]);
	expect(body.publiclyVisible).toBe(false);
});

test("POST /v1/gauge-stations accepts creating an inactive gaugeStation", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/gauge-stations",
		headers: { cookie: admin.cookie },
		body: {
			name: "GS-test-born-inactive",
			clientId: 2,
			cityId: 2,
			location: "Hudson Creek",
			latitude: 30.7,
			longitude: -96.35,
			active: false,
		},
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<GaugeStationBody>().active).toBe(false);
});

test("POST /v1/gauge-stations rejects duplicate gaugeStation names", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/gauge-stations",
		headers: { cookie: admin.cookie },
		body: {
			name: "GS-test-created",
			clientId: 2,
			cityId: 2,
			location: "Duplicate",
			latitude: 30.6,
			longitude: -96.3,
		},
	});

	expect(res.statusCode).toBe(409);
});

test("POST /v1/gauge-stations rejects an unknown city", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/gauge-stations",
		headers: { cookie: admin.cookie },
		body: {
			name: "GS-test-bad-city",
			clientId: 2,
			cityId: 9999,
			location: "Nowhere",
			latitude: 30.6,
			longitude: -96.3,
		},
	});

	expect(res.statusCode).toBe(400);
});

test("PATCH /v1/gauge-stations/:id updates info as a new SCD row", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/gauge-stations/${createdGaugeStationId}`,
		headers: { cookie: admin.cookie },
		body: { location: "Burton Creek Upstream", publiclyVisible: false },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<GaugeStationBody>()).toEqual(
		expect.objectContaining({
			id: createdGaugeStationId,
			location: "Burton Creek Upstream",
			publiclyVisible: false,
			latitude: 30.6689,
		}),
	);

	// SCD Type 2: the previous info row is archived, not overwritten.
	const rows = await db.pool.query<{ location: string; archived: Date | null }>(
		`SELECT location, archived FROM gauge_station_info
		 WHERE gauge_station_id = $1 ORDER BY id`,
		[createdGaugeStationId],
	);
	expect(rows.rows).toHaveLength(2);
	expect(rows.rows[0]!.location).toBe("Burton Creek");
	expect(rows.rows[0]!.archived).not.toBeNull();
	expect(rows.rows[1]!.location).toBe("Burton Creek Upstream");
	expect(rows.rows[1]!.archived).toBeNull();
});

test("PATCH /v1/gauge-stations/:id renames without touching the info row", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/gauge-stations/${createdGaugeStationId}`,
		headers: { cookie: admin.cookie },
		body: { name: "GS-test-renamed" },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<GaugeStationBody>().name).toBe("GS-test-renamed");

	const rows = await db.pool.query(
		`SELECT id FROM gauge_station_info WHERE gauge_station_id = $1`,
		[createdGaugeStationId],
	);
	expect(rows.rows).toHaveLength(2);
});

test("PATCH /v1/gauge-stations/:id deactivates a gaugeStation as a new SCD row", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/gauge-stations/${createdGaugeStationId}`,
		headers: { cookie: admin.cookie },
		body: { active: false },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<GaugeStationBody>().active).toBe(false);

	const rows = await db.pool.query<{ active: boolean; archived: Date | null }>(
		`SELECT active, archived FROM gauge_station_info
		 WHERE gauge_station_id = $1 ORDER BY id`,
		[createdGaugeStationId],
	);
	expect(rows.rows).toHaveLength(3);
	expect(rows.rows[2]!.active).toBe(false);
	expect(rows.rows[2]!.archived).toBeNull();
	expect(rows.rows[1]!.archived).not.toBeNull();
});

test("PATCH /v1/gauge-stations/:id hides another client's gaugeStation from client users", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/gauge-stations/${torresStationId}`,
		headers: { cookie: clientManager.cookie },
		body: { location: "Hijacked" },
	});

	expect(res.statusCode).toBe(404);
});
