import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import type { MqtxClient } from "@/lib/mqtx/MqtxClient";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";
import { seedDeviceFixtures } from "./helpers/fixtures";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;
let admin: TestUserSession;
let clientManager: TestUserSession;
let deviceOnlyUser: TestUserSession;
let controlPanelOnlyUser: TestUserSession;
let bryanCameraId: number;
let collegeStationCameraId: number;

const mqtxCalls: Array<{
	method: string;
	deviceId: string;
	version?: string;
	payload?: unknown;
}> = [];

const fakeMqtx = {
	async sendConfigUpdate(deviceId: string, version: string, payload: unknown) {
		mqtxCalls.push({ method: "config", deviceId, version, payload });
		return { status: 200, success: true, body: "OK" };
	},
	async sendCameraCaptureGet(deviceId: string, version: string, payload: unknown) {
		mqtxCalls.push({
			method: "camera-capture",
			deviceId,
			version,
			payload,
		});
		return { status: 202, success: true, body: "Accepted" };
	},
	async sendLegacyCameraCapture(deviceId: string) {
		mqtxCalls.push({ method: "legacy-camera-capture", deviceId });
		return { status: 200, success: true, body: "OK" };
	},
} as unknown as MqtxClient;

interface CameraBody {
	camera: {
		id: number;
		device_id: number;
		device_serial_number: string;
		gauge_station_id: number;
		page_version: string | null;
	};
	camera_config: { selected_preset: number; boot_time_delay: number } | null;
	camera_config_presets: Array<{
		local_preset_id: number;
		pan: number;
		tilt: number;
		zoom: number;
	}>;
	camera_config_rotation: { rotation: number } | null;
}

interface CaptureBody {
	id: number;
	camera_data_record_id: string;
	path: string;
	file_type: string;
	is_tagged: boolean;
	date: string;
	camera_id: number;
	device_id: number;
	device_serial_number: string;
}

async function insertCameraFixture(input: {
	serialNumber: string;
	gaugeStationId: number;
	latitude: number;
	longitude: number;
	capturePath: string;
	isTagged: boolean;
}): Promise<number> {
	const device = await db.pool.query<{ id: number }>(
		`INSERT INTO device (serial_number) VALUES ($1) RETURNING id`,
		[input.serialNumber],
	);
	const deviceId = device.rows[0]!.id;
	await db.pool.query(
		`INSERT INTO device_info (device_id, gauge_station_id, type, page_version, active, latitude, longitude)
		 VALUES ($1, $2, 'camera', '3.1', TRUE, $3, $4)`,
		[deviceId, input.gaugeStationId, input.latitude, input.longitude],
	);
	const camera = await db.pool.query<{ id: number }>(
		`INSERT INTO camera (device_id, local_id) VALUES ($1, 1) RETURNING id`,
		[deviceId],
	);
	const cameraId = camera.rows[0]!.id;
	await db.pool.query(
		`INSERT INTO camera_config (camera_id, pan, tilt, zoom, selected_preset, boot_time_delay, check_in_time)
		 VALUES ($1, 1.5, 2.5, 3.5, 7, 15, 'mon14:30')`,
		[cameraId],
	);
	await db.pool.query(
		`INSERT INTO camera_config_preset (camera_id, local_preset_id, pan, tilt, zoom)
		 VALUES ($1, 1, 10, 20, 30)`,
		[cameraId],
	);
	await db.pool.query(
		`INSERT INTO camera_config_rotation (camera_id, rotation) VALUES ($1, 90)`,
		[cameraId],
	);
	const record = await db.pool.query<{ id: string }>(
		`INSERT INTO camera_data_record (camera_id, date) VALUES ($1, '2026-08-01T12:00:00Z') RETURNING id::text AS id`,
		[cameraId],
	);
	await db.pool.query(
		`INSERT INTO camera_capture_data (camera_data_record_id, path, file_type, is_tagged)
		 VALUES ($1, $2, $3, $4)`,
		[
			record.rows[0]!.id,
			input.capturePath,
			`atlas/3.1/${input.serialNumber}/capture/response${input.isTagged ? "T" : "N"}/${input.capturePath.split("/").pop()}`,
			input.isTagged,
		],
	);
	await db.pool.query(
		`INSERT INTO camera_detection_data (camera_data_record_id, object, present_duration, confidence, stalled, water_level)
		 VALUES ($1, 'car', 12.5, 0.76, FALSE, $2)`,
		[record.rows[0]!.id, 3.25],
	);
	return cameraId;
}

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	await seedDeviceFixtures(db.pool);
	app = await buildApp({ pool: db.pool, logger: false, mqtx: fakeMqtx });

	admin = await signUpTestUser(app, {
		email: "cameras-admin@example.com",
		name: "Cameras Admin",
		client_id: 1,
		role_id: 1,
	});
	clientManager = await signUpTestUser(app, {
		email: "cameras-client-manager@example.com",
		name: "Cameras Client Manager",
		client_id: 2,
		role_id: 3,
	});

	const deviceOnlyRole = await db.pool.query<{ id: number }>(
		`INSERT INTO role (name, client_id) VALUES ('CAMERA_DEVICE_ONLY', 2) RETURNING id`,
	);
	await db.pool.query(
		`INSERT INTO role_permission (role_id, permission_id) VALUES ($1, 1), ($1, 2)`,
		[deviceOnlyRole.rows[0]!.id],
	);
	deviceOnlyUser = await signUpTestUser(app, {
		email: "cameras-device-only@example.com",
		name: "Cameras Device Only",
		client_id: 2,
		role_id: deviceOnlyRole.rows[0]!.id,
	});

	const controlPanelOnlyRole = await db.pool.query<{ id: number }>(
		`INSERT INTO role (name, client_id) VALUES ('CAMERA_CONTROL_PANEL_ONLY', 2) RETURNING id`,
	);
	await db.pool.query(
		`INSERT INTO role_permission (role_id, permission_id) VALUES ($1, 5), ($1, 6)`,
		[controlPanelOnlyRole.rows[0]!.id],
	);
	controlPanelOnlyUser = await signUpTestUser(app, {
		email: "cameras-control-panel-only@example.com",
		name: "Cameras Control Panel Only",
		client_id: 2,
		role_id: controlPanelOnlyRole.rows[0]!.id,
	});

	bryanCameraId = await insertCameraFixture({
		serialNumber: "bryan-camera-device",
		gaugeStationId: 1,
		latitude: 30.6744,
		longitude: -96.37,
		capturePath: "1/bryan-image.jpg",
		isTagged: true,
	});
	collegeStationCameraId = await insertCameraFixture({
		serialNumber: "college-camera-device",
		gaugeStationId: 2,
		latitude: 30.6279,
		longitude: -96.3344,
		capturePath: "1/college-image.jpg",
		isTagged: false,
	});
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("GET /v1/cameras limits client managers to their client's cameras", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/cameras",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const serials = res
		.json<{ data: CameraBody[] }>()
		.data.map((row) => row.camera.device_serial_number);
	expect(serials).toContain("bryan-camera-device");
	expect(serials).not.toContain("college-camera-device");
});

test("GET /v1/cameras lets admins list cameras across clients", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/cameras",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = res.json<{ data: CameraBody[] }>().data.map((row) => row.camera.id);
	expect(ids).toContain(bryanCameraId);
	expect(ids).toContain(collegeStationCameraId);
});

test("GET /v1/cameras/:deviceId returns camera config metadata", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/cameras/bryan-camera-device",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<CameraBody>()).toEqual(
		expect.objectContaining({
			camera: expect.objectContaining({
				id: bryanCameraId,
				device_serial_number: "bryan-camera-device",
				page_version: "3.1",
			}),
			camera_config: expect.objectContaining({
				selected_preset: 7,
				boot_time_delay: 15,
			}),
			camera_config_presets: expect.arrayContaining([
				expect.objectContaining({ local_preset_id: 1, pan: 10 }),
			]),
			camera_config_rotation: expect.objectContaining({ rotation: 90 }),
		}),
	);
});

test("GET /v1/cameras/:deviceId hides another client's camera", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/cameras/college-camera-device",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("GET /v1/cameras/:deviceId/data returns data records with captures and detections", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/cameras/bryan-camera-device/data?from=2026-08-01T00:00:00Z&to=2026-08-02T00:00:00Z",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<{
		data: Array<{
			captures: CaptureBody[];
			detections: Array<{
				object: string;
				confidence: number;
				water_level: number;
			}>;
		}>;
	}>();
	expect(body.data).toHaveLength(1);
	expect(body.data[0]!.captures).toEqual(
		expect.arrayContaining([expect.objectContaining({ path: "1/bryan-image.jpg" })]),
	);
	expect(body.data[0]!.detections).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				object: "car",
				confidence: 0.76,
				water_level: 3.25,
			}),
		]),
	);
});

test("GET /v1/cameras/:deviceId/data allows device readers without control panel permissions", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/cameras/bryan-camera-device/data",
		headers: { cookie: deviceOnlyUser.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ data: Array<{ captures: CaptureBody[] }> }>().data[0]!.captures).toEqual(
		expect.arrayContaining([expect.objectContaining({ path: "1/bryan-image.jpg" })]),
	);
});

test("GET /v1/cameras/:deviceId/3.1/images returns DB image metadata without S3 URLs", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/cameras/bryan-camera-device/3.1/images?taggedOnly&limit=1",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<{ data: CaptureBody[] }>();
	expect(body.data).toHaveLength(1);
	expect(body.data[0]).toEqual(
		expect.objectContaining({
			path: "1/bryan-image.jpg",
			file_type: "atlas/3.1/bryan-camera-device/capture/responseT/bryan-image.jpg",
			is_tagged: true,
		}),
	);
	expect(body.data[0]).not.toHaveProperty("url");
});

test("GET /v1/cameras/:deviceId/3.1/images allows device readers without control panel permissions", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/cameras/bryan-camera-device/3.1/images?limit=1",
		headers: { cookie: deviceOnlyUser.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ data: CaptureBody[] }>().data[0]).toEqual(
		expect.objectContaining({
			path: "1/bryan-image.jpg",
		}),
	);
});
test("GET /v1/cameras/:deviceId/3.1/images/signed looks up metadata by stored path", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/cameras/bryan-camera-device/3.1/images/signed?path=1/bryan-image.jpg",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<CaptureBody>()).toEqual(expect.objectContaining({ path: "1/bryan-image.jpg" }));
});

test("GET /v1/cameras/:deviceId/images/signed rejects paths for another camera", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/cameras/bryan-camera-device/images/signed?path=1/college-image.jpg",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(403);
});

test("POST /v1/cameras/:deviceId/3.1/capture sends capture request to MQTX", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/cameras/bryan-camera-device/3.1/capture",
		headers: { cookie: clientManager.cookie },
		body: { annotate: 1, format: { type: 1 } },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ message: string; status: number }>()).toEqual({
		message: "Accepted",
		status: 202,
	});
	expect(mqtxCalls).toContainEqual({
		method: "camera-capture",
		deviceId: "bryan",
		version: "3.1",
		payload: { capture: { annotate: 1, format: { type: 1 } } },
	});
});

test("POST /v1/cameras/:deviceId/3.1/capture allows control panel writers without device write permission", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/cameras/bryan-camera-device/3.1/capture",
		headers: { cookie: controlPanelOnlyUser.cookie },
		body: { annotate: 1, format: { type: 1 } },
	});

	expect(res.statusCode).toBe(200);
	expect(mqtxCalls).toContainEqual(
		expect.objectContaining({
			method: "camera-capture",
			deviceId: "bryan",
		}),
	);
});

test("POST /v1/cameras/:deviceId/3.1/capture requires control panel permissions", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/cameras/bryan-camera-device/3.1/capture",
		headers: { cookie: deviceOnlyUser.cookie },
		body: { annotate: 1, format: { type: 1 } },
	});

	expect(res.statusCode).toBe(403);
	expect(mqtxCalls).toEqual([]);
});

test("POST /v1/cameras/:deviceId/3.1/config allows control panel writers without device write permission", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/cameras/bryan-camera-device/3.1/config",
		headers: { cookie: controlPanelOnlyUser.cookie },
		body: { camera: { selectedPreset: 1 } },
	});

	expect(res.statusCode).toBe(200);
	expect(mqtxCalls).toContainEqual(
		expect.objectContaining({
			method: "config",
			deviceId: "bryan",
			version: "3.1",
		}),
	);
});

test("POST /v1/cameras/:deviceId/3.1/config allows device writers without control panel permission", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/cameras/bryan-camera-device/3.1/config",
		headers: { cookie: deviceOnlyUser.cookie },
		body: { camera: { selectedPreset: 1 } },
	});

	expect(res.statusCode).toBe(200);
	expect(mqtxCalls).toContainEqual(
		expect.objectContaining({
			method: "config",
			deviceId: "bryan",
			version: "3.1",
		}),
	);
});

test("POST /v1/cameras/:deviceId/3.1/config sends validated config to MQTX", async () => {
	mqtxCalls.length = 0;
	const config = {
		camera: {
			selectedPreset: 1,
			checkInTime: "mon14:30",
			presets: [{ id: 1, pan: 10, tilt: 20, zoom: 30 }],
		},
	};
	const res = await app.inject({
		method: "POST",
		url: "/v1/cameras/bryan-camera-device/3.1/config",
		headers: { cookie: clientManager.cookie },
		body: config,
	});

	expect(res.statusCode).toBe(200);
	expect(mqtxCalls).toContainEqual({
		method: "config",
		deviceId: "bryan",
		version: "3.1",
		payload: config,
	});
});

test("POST /v1/cameras/:deviceId/images sends legacy capture command", async () => {
	mqtxCalls.length = 0;
	const res = await app.inject({
		method: "POST",
		url: "/v1/cameras/bryan-camera-device/images",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(mqtxCalls).toContainEqual({
		method: "legacy-camera-capture",
		deviceId: "bryan",
	});
});
