import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import type { EmnifyClient, EmnifySimState } from "@/lib/emnify/EmnifyClient";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;
let admin: TestUserSession;
let cityManager: TestUserSession;

const stateUpdates: Array<{ iccid: string; state: EmnifySimState }> = [];
const activations: Array<{
	iccid: string;
	bic: string;
	box: { serialNumber: string; boxTypeId: string };
}> = [];
const costRequests: Array<{ startDate?: string; endDate?: string }> = [];

const fakeEmnify = {
	async updateSimState(iccid: string, state: EmnifySimState) {
		stateUpdates.push({ iccid, state });
	},
	async activateSim(input: {
		iccid: string;
		bic: string;
		box: { serialNumber: string; boxTypeId: string };
	}) {
		activations.push(input);
		return {
			status: 200 as const,
			message: "Emnify SIM Activated Successfully",
		};
	},
	async getCosts(input: { startDate?: string; endDate?: string }) {
		costRequests.push(input);
		return {
			totalCost: 18.25,
			costByDate: [{ date: "2026-08-01", amount: 18.25 }],
			service: {
				service: "Emnify: SIMs & Cellular Data",
				amount: 18.25,
				percentage: 0,
				color: "#6366F1",
				provider: "emnify" as const,
			},
		};
	},
} as unknown as EmnifyClient;

interface ActivationBody {
	status: 200;
	message: string;
}

interface CostsBody {
	totalCost: number;
	costByDate: Array<{ date: string; amount: number }>;
	service: {
		service: string;
		amount: number;
		percentage: number;
		color: string;
		provider: "emnify";
	};
}

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false, emnify: fakeEmnify });

	admin = await signUpTestUser(app, {
		email: "emnify-admin@example.com",
		name: "Emnify Admin",
		client_id: 1,
		role_id: 1,
	});
	cityManager = await signUpTestUser(app, {
		email: "emnify-client-manager@example.com",
		name: "Emnify Client Manager",
		client_id: 2,
		role_id: 3,
	});
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("PATCH /v1/emnify/:iccid/:state updates an Emnify SIM state", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: "/v1/emnify/8901000000000000000/1",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(204);
	expect(stateUpdates).toContainEqual({ iccid: "8901000000000000000", state: 1 });
});

test("PATCH /v1/emnify/:iccid/:state rejects invalid state", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: "/v1/emnify/8901000000000000000/3",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(400);
});

test("PATCH /v1/emnify/:iccid/:state rejects client device writers", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: "/v1/emnify/8901000000000000000/2",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(403);
});

test("POST /v1/emnify/activate activates an Emnify SIM", async () => {
	const body = {
		iccid: "8901000000000000000",
		bic: "BIC123",
		box: { serialNumber: "BOX-101", boxTypeId: "device" },
	};
	const res = await app.inject({
		method: "POST",
		url: "/v1/emnify/activate",
		headers: { cookie: admin.cookie },
		body,
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<ActivationBody>()).toEqual({
		status: 200,
		message: "Emnify SIM Activated Successfully",
	});
	expect(activations).toContainEqual(body);
});

test("POST /v1/emnify/activate rejects client device writers", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/emnify/activate",
		headers: { cookie: cityManager.cookie },
		body: {
			iccid: "8901000000000000000",
			bic: "BIC123",
			box: { serialNumber: "BOX-101", boxTypeId: "device" },
		},
	});

	expect(res.statusCode).toBe(403);
});

test("GET /v1/emnify/costs returns processed Emnify costs", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/emnify/costs?startDate=2026-08-01T00:00:00.000Z&endDate=2026-08-02T00:00:00.000Z",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<CostsBody>()).toEqual({
		totalCost: 18.25,
		costByDate: [{ date: "2026-08-01", amount: 18.25 }],
		service: {
			service: "Emnify: SIMs & Cellular Data",
			amount: 18.25,
			percentage: 0,
			color: "#6366F1",
			provider: "emnify",
		},
	});
	expect(costRequests).toContainEqual({
		startDate: "2026-08-01T00:00:00.000Z",
		endDate: "2026-08-02T00:00:00.000Z",
	});
});

test("GET /v1/emnify/costs rejects client device readers", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/emnify/costs",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(403);
});
