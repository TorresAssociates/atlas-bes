import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;
let admin: TestUserSession;
let cityManager: TestUserSession;
let createdCityId: number;

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "city-admin@example.com",
		name: "City Admin",
		client_id: 1,
		role_id: 1,
	});
	cityManager = await signUpTestUser(app, {
		email: "city-manager@example.com",
		name: "City Manager",
		client_id: 2,
		role_id: 3,
	});

	const stations = await db.pool.query<{ id: number; name: string }>(
		`INSERT INTO gauge_station (name)
		 VALUES ('city-test-station-one'), ('city-test-station-two')
		 RETURNING id, name`,
	);
	const stationOneId = stations.rows.find((station) => station.name === "city-test-station-one")!.id;
	const stationTwoId = stations.rows.find((station) => station.name === "city-test-station-two")!.id;

	await db.pool.query(
		`INSERT INTO gauge_station_info (gauge_station_id, city_id, location, latitude, longitude)
		 VALUES ($1, 1, 'City Test Location One', 30.6279, -96.3344), ($2, 2, 'City Test Location Two', 30.6744, -96.37)`,
		[stationOneId, stationTwoId],
	);
	await db.pool.query(
		`INSERT INTO client_gauge_station (gauge_station_id, client_id)
		 VALUES ($1, 1), ($2, 2)`,
		[stationOneId, stationTwoId],
	);
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

interface CityBody {
	id: number;
	state: string;
	name: string;
}

interface CityListBody {
	data: CityBody[];
}

test("GET /v1/city returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/city" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/city lets admins see all cities", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/city",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<CityListBody>();
	expect(body.data.map((city) => city.id)).toEqual(expect.arrayContaining([1, 2]));
});

test("GET /v1/city limits session users to their own cities", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/city",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<CityListBody>();
	expect(body.data).toEqual([expect.objectContaining({ id: 2, name: "Bryan" })]);
});

test("GET /v1/city/:id hides another client's city from session users", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/city/1",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("POST /v1/city lets admins create a city", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/city",
		headers: { cookie: admin.cookie },
		body: { state: "tx", name: "Navasota" },
	});

	expect(res.statusCode).toBe(201);
	const body = res.json<CityBody>();
	expect(body).toEqual(expect.objectContaining({ state: "TX", name: "Navasota" }));
	createdCityId = body.id;
});

test("POST /v1/city rejects non-admin session users", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/city",
		headers: { cookie: cityManager.cookie },
		body: { state: "TX", name: "Hearne" },
	});

	expect(res.statusCode).toBe(403);
});

test("PATCH /v1/city/:id lets admins update a city", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/city/${createdCityId}`,
		headers: { cookie: admin.cookie },
		body: { name: "Navasota Updated" },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<CityBody>()).toEqual(
		expect.objectContaining({ id: createdCityId, state: "TX", name: "Navasota Updated" }),
	);
});

test("PATCH /v1/city/:id rejects non-admin session users", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: "/v1/city/2",
		headers: { cookie: cityManager.cookie },
		body: { name: "Bryan Updated" },
	});

	expect(res.statusCode).toBe(403);
});
