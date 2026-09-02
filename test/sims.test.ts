import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import type { EmnifyClient } from "@/lib/emnify/EmnifyClient";
import type { HologramClient } from "@/lib/hologram/HologramClient";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";
import { seedDeviceFixtures } from "./helpers/fixtures";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;
let admin: TestUserSession;
let clientManager: TestUserSession;

const hologramActivations: Array<{ iccid: string; boxId: string }> = [];
const emnifyActivations: Array<{
	iccid: string;
	bic: string;
	box: { serialNumber: string; boxTypeId: string };
}> = [];

const fakeHologram = {
	async activateSim(input: { iccid: string; boxId: string }) {
		hologramActivations.push(input);
		return {
			status: 200,
			message: "Hologram SIM Activated Successfully",
			deviceId: 54321,
		};
	},
} as unknown as HologramClient;

const fakeEmnify = {
	async activateSim(input: {
		iccid: string;
		bic: string;
		box: { serialNumber: string; boxTypeId: string };
	}) {
		emnifyActivations.push(input);
		return { status: 200 as const, message: "Emnify SIM Activated Successfully" };
	},
} as unknown as EmnifyClient;

interface SimBody {
	id: number;
	iccid: string;
	imei: string | null;
	isActivated: boolean;
	isPaused: boolean;
	boxSerialNumber: string | null;
	gaugeStationName: string | null;
	simProvider: { name: string; apn: string | null };
	deviceId?: number;
	bic?: string;
}

async function seedSim(input: {
	iccid: string;
	provider: "hologram" | "emnify";
	imei?: string;
	activated?: boolean;
	paused?: boolean;
	deviceId?: number;
	hologramDeviceId?: number;
	bic?: string;
}): Promise<number> {
	const sim = await db.pool.query<{ id: number }>(
		`INSERT INTO sim (iccid, provider) VALUES ($1, $2) RETURNING id`,
		[input.iccid, input.provider],
	);
	const simId = sim.rows[0]!.id;
	if (input.imei) {
		await db.pool.query(
			`INSERT INTO sim_info (sim_id, imei, activated, paused) VALUES ($1, $2, $3, $4)`,
			[simId, input.imei, input.activated ?? false, input.paused ?? false],
		);
	}
	if (input.provider === "hologram") {
		await db.pool.query(`INSERT INTO sim_info_hologram (sim_id, device_id) VALUES ($1, $2)`, [
			simId,
			input.hologramDeviceId ?? 12345,
		]);
	} else {
		await db.pool.query(`INSERT INTO sim_info_emnify (sim_id, bic) VALUES ($1, $2)`, [
			simId,
			input.bic ?? "BIC1234567890123",
		]);
	}
	if (input.deviceId) {
		await db.pool.query(
			`INSERT INTO device_sim (device_id, sim_id, sim_index) VALUES ($1, $2, 0)`,
			[input.deviceId, simId],
		);
	}
	return simId;
}

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	await seedDeviceFixtures(db.pool);
	app = await buildApp({
		pool: db.pool,
		logger: false,
		hologram: fakeHologram,
		emnify: fakeEmnify,
	});

	admin = await signUpTestUser(app, {
		email: "sims-admin@example.com",
		name: "Sims Admin",
		client_id: 1,
		role_id: 1,
	});
	clientManager = await signUpTestUser(app, {
		email: "sims-client-manager@example.com",
		name: "Sims Client Manager",
		client_id: 2,
		role_id: 3,
	});

	await seedSim({
		iccid: "89010000000000000001",
		provider: "hologram",
		imei: "123456789012345",
		deviceId: 1,
		hologramDeviceId: 11111,
	});
	await seedSim({
		iccid: "89010000000000000002",
		provider: "emnify",
		imei: "123456789012345",
		deviceId: 1,
		bic: "BIC1234567890123",
	});
	await seedSim({
		iccid: "89010000000000000003",
		provider: "hologram",
		imei: "555555555555555",
		deviceId: 2,
		hologramDeviceId: 22222,
	});
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("GET /v1/sims limits client readers to their client's device SIMs", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/sims",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<{ data: SimBody[] }>().data;
	expect(body.map((sim) => sim.iccid).sort()).toEqual([
		"89010000000000000001",
		"89010000000000000002",
	]);
});

test("GET /v1/sims lets admins see every SIM", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/sims",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ data: SimBody[] }>().data.map((sim) => sim.iccid)).toContain(
		"89010000000000000003",
	);
});

test("GET /v1/sims/:iccid returns provider-specific SIM details", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/sims/89010000000000000002",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<SimBody>()).toEqual(
		expect.objectContaining({
			iccid: "89010000000000000002",
			imei: "123456789012345",
			bic: "BIC1234567890123",
			boxSerialNumber: "bryan-test-device",
			gaugeStationName: "bryan-test-GS",
			simProvider: { name: "emnify", apn: "em" },
		}),
	);
});

test("GET /v1/sims/:iccid hides another client's SIM from client readers", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/sims/89010000000000000003",
		headers: { cookie: clientManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("POST /v1/sims creates a Hologram SIM", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/sims",
		headers: { cookie: admin.cookie },
		body: {
			simType: "hologram",
			iccid: "89010000000000000004",
			deviceId: 44444,
		},
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<{ message: string; usimId: number }>()).toEqual(
		expect.objectContaining({
			message: "SIM card inserted successfully",
		}),
	);
});

test("POST /v1/sims returns 409 for duplicate ICCID", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/sims",
		headers: { cookie: admin.cookie },
		body: {
			simType: "hologram",
			iccid: "89010000000000000001",
			deviceId: 44444,
		},
	});

	expect(res.statusCode).toBe(409);
	expect(res.json<{ message: string; usimId: number }>()).toEqual({
		message: "SIM card already exists",
		usimId: 0,
	});
});

test("PUT /v1/sims updates a SIM IMEI", async () => {
	const res = await app.inject({
		method: "PUT",
		url: "/v1/sims",
		headers: { cookie: admin.cookie },
		body: {
			iccid: "89010000000000000004",
			imei: "999999999999999",
		},
	});

	expect(res.statusCode).toBe(200);
	const getRes = await app.inject({
		method: "GET",
		url: "/v1/sims/89010000000000000004",
		headers: { cookie: admin.cookie },
	});
	expect(getRes.json<SimBody>().imei).toBe("999999999999999");
});

test("POST /v1/sims/activate activates all inactive SIMs for an IMEI", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/sims/activate",
		headers: { cookie: clientManager.cookie },
		body: {
			imei: "123456789012345",
			boxType: "gauge",
			gaugeStationId: "bryan-test-GS",
		},
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ message: string; boxId: number }>()).toEqual({
		message: "SIM card activated successfully",
		boxId: 1,
	});
	expect(hologramActivations).toContainEqual({
		iccid: "89010000000000000001",
		boxId: "bryan-test-device",
	});
	expect(emnifyActivations).toContainEqual({
		iccid: "89010000000000000002",
		bic: "BIC1234567890123",
		box: { serialNumber: "bryan-test-device", boxTypeId: "gauge" },
	});

	const listRes = await app.inject({
		method: "GET",
		url: "/v1/sims/89010000000000000001",
		headers: { cookie: admin.cookie },
	});
	expect(listRes.json<SimBody>()).toEqual(
		expect.objectContaining({
			isActivated: true,
			isPaused: false,
			deviceId: 54321,
		}),
	);
});

test("POST /v1/sims/activate hides another client's device from client writers", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/sims/activate",
		headers: { cookie: clientManager.cookie },
		body: {
			imei: "555555555555555",
			boxType: "gauge",
			gaugeStationId: "college-station-test-GS",
		},
	});

	expect(res.statusCode).toBe(403);
});
