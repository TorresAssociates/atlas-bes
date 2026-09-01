import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import type { HologramClient, HologramSimState } from "@/lib/hologram/HologramClient";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;
let admin: TestUserSession;
let cityManager: TestUserSession;

const stateUpdates: Array<{ deviceId: string; state: HologramSimState }> = [];
const activations: Array<{ iccid: string; boxId: string }> = [];
const costRequests: Array<{ startDate?: string; endDate?: string; limit?: number }> = [];

const fakeHologram = {
	async updateDeviceState(deviceId: string, state: HologramSimState) {
		stateUpdates.push({ deviceId, state });
	},
	async activateSim(input: { iccid: string; boxId: string }) {
		activations.push(input);
		return {
			status: 200,
			message: "Hologram SIM Activated Successfully",
			deviceId: 98765,
		};
	},
	async getGlobalStandardFlatRatePlan() {
		return { status: 200, planId: 12345 };
	},
	async getCosts(input: { startDate?: string; endDate?: string; limit?: number }) {
		costRequests.push(input);
		return {
			totalCost: 12.75,
			costByDate: [{ date: "2026-08-01", amount: 12.75 }],
			service: {
				service: "Hologram: SIMs & Cellular Data",
				amount: 12.75,
				percentage: 0,
				color: "#00C7B7",
				provider: "hologram" as const,
			},
		};
	},
} as unknown as HologramClient;
interface ActivationBody {
	status: number;
	message: string;
	deviceId: number | null;
}

interface PlanBody {
	status: number;
	planId: number;
}

interface CostsBody {
	totalCost: number;
	costByDate: Array<{ date: string; amount: number }>;
	service: {
		service: string;
		amount: number;
		percentage: number;
		color: string;
		provider: "hologram";
	};
}

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false, hologram: fakeHologram });

	admin = await signUpTestUser(app, {
		email: "hologram-admin@example.com",
		name: "Hologram Admin",
		client_id: 1,
		role_id: 1,
	});
	cityManager = await signUpTestUser(app, {
		email: "hologram-client-manager@example.com",
		name: "Hologram Client Manager",
		client_id: 2,
		role_id: 3,
	});
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("PATCH /v1/hologram/:deviceId/:state updates a Hologram device state", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: "/v1/hologram/12345/pause",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(204);
	expect(stateUpdates).toContainEqual({ deviceId: "12345", state: "pause" });
});

test("PATCH /v1/hologram/:deviceId/:state rejects invalid state", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: "/v1/hologram/12345/bad-state",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(400);
});

test("PATCH /v1/hologram/:deviceId/:state rejects client report writers", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: "/v1/hologram/12345/resume",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(403);
});

test("POST /v1/hologram/activate activates a Hologram SIM", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/hologram/activate",
		headers: { cookie: admin.cookie },
		body: { iccid: "8901000000000000000", boxId: "box-101" },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<ActivationBody>()).toEqual({
		status: 200,
		message: "Hologram SIM Activated Successfully",
		deviceId: 98765,
	});
	expect(activations).toContainEqual({ iccid: "8901000000000000000", boxId: "box-101" });
});

test("GET /v1/hologram/plans returns the Global Standard Flat Rate plan id", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/hologram/plans",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<PlanBody>()).toEqual({ status: 200, planId: 12345 });
});

test("GET /v1/hologram/costs returns processed Hologram costs", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/hologram/costs?startDate=2026-08-01T00:00:00.000Z&endDate=2026-08-02T00:00:00.000Z&limit=50",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<CostsBody>()).toEqual({
		totalCost: 12.75,
		costByDate: [{ date: "2026-08-01", amount: 12.75 }],
		service: {
			service: "Hologram: SIMs & Cellular Data",
			amount: 12.75,
			percentage: 0,
			color: "#00C7B7",
			provider: "hologram",
		},
	});
	expect(costRequests).toContainEqual({
		startDate: "2026-08-01T00:00:00.000Z",
		endDate: "2026-08-02T00:00:00.000Z",
		limit: 50,
	});
});

test("GET /v1/hologram/costs rejects client report readers", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/hologram/costs",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(403);
});
