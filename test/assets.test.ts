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
let clientAssetTypeId: number;
let externalAssetTypeId: number;
let clientAssetId: number;
let externalAssetId: number;
let createdAssetId: number;

interface AssetBody {
	id: number;
	asset_type_id: number;
	cost: string | null;
	creation_date: string;
	deploy_date: string | null;
	eos_date: string | null;
	gauge_station_id: number;
	serial_number: string | null;
}

interface AssetListBody {
	data: AssetBody[];
}

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "assets-admin@example.com",
		name: "Assets Admin",
		client_id: 1,
		role_id: 1,
	});
	cityManager = await signUpTestUser(app, {
		email: "assets-manager@example.com",
		name: "Assets Manager",
		client_id: 2,
		role_id: 3,
	});

	const assetTypes = await db.pool.query<{ id: number; name: string }>(
		`INSERT INTO asset_type (owner_client_id, name)
		 VALUES (2, 'client-asset-type'),
		        (1, 'external-asset-type')
		 RETURNING id, name`,
	);
	clientAssetTypeId = assetTypes.rows.find((row) => row.name === "client-asset-type")!.id;
	externalAssetTypeId = assetTypes.rows.find((row) => row.name === "external-asset-type")!.id;

	const assets = await db.pool.query<{ id: number; serial_number: string }>(
		`INSERT INTO asset (asset_type_id, serial_number, creation_date, deploy_date, eos_date, cost, gauge_station_id)
		 VALUES ($1, 'client-visible-asset', '2026-01-01T00:00:00Z', NULL, NULL, '$100.00', 1),
		        ($2, 'external-visible-asset', '2026-01-02T00:00:00Z', NULL, NULL, '$200.00', 2)
		 RETURNING id, serial_number`,
		[clientAssetTypeId, externalAssetTypeId],
	);
	clientAssetId = assets.rows.find((row) => row.serial_number === "client-visible-asset")!.id;
	externalAssetId = assets.rows.find((row) => row.serial_number === "external-visible-asset")!.id;
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("GET /v1/assets limits client readers to assets on their gauges", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/assets",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = res.json<AssetListBody>().data.map((asset) => asset.id);
	expect(ids).toContain(clientAssetId);
	expect(ids).not.toContain(externalAssetId);
});

test("GET /v1/assets lets admins see all assets", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/assets",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<AssetListBody>().data.map((asset) => asset.id)).toEqual(
		expect.arrayContaining([clientAssetId, externalAssetId]),
	);
});

test("GET /v1/assets/:id returns a same-client asset", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/assets/${clientAssetId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<AssetBody>()).toEqual(expect.objectContaining({ id: clientAssetId }));
});

test("GET /v1/assets/:id hides another client's asset", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/assets/${externalAssetId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("POST /v1/assets creates a same-client asset", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/assets",
		headers: { cookie: cityManager.cookie },
		body: {
			asset_type_id: clientAssetTypeId,
			serial_number: "client-created-asset",
			creation_date: "2026-02-01T00:00:00.000Z",
			deploy_date: null,
			eos_date: null,
			cost: "$150.00",
			gauge_station_id: 1,
		},
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<AssetBody>()).toEqual(
		expect.objectContaining({
			asset_type_id: clientAssetTypeId,
			serial_number: "client-created-asset",
			gauge_station_id: 1,
			deploy_date: null,
			eos_date: null,
		}),
	);
	createdAssetId = res.json<AssetBody>().id;
});

test("POST /v1/assets rejects a client writer using another client's asset type", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/assets",
		headers: { cookie: cityManager.cookie },
		body: {
			asset_type_id: externalAssetTypeId,
			serial_number: "wrong-type-asset",
			creation_date: "2026-02-02T00:00:00.000Z",
			gauge_station_id: 1,
		},
	});

	expect(res.statusCode).toBe(403);
});

test("POST /v1/assets rejects a client writer using another client's gauge", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/assets",
		headers: { cookie: cityManager.cookie },
		body: {
			asset_type_id: clientAssetTypeId,
			serial_number: "wrong-gauge-asset",
			creation_date: "2026-02-03T00:00:00.000Z",
			gauge_station_id: 2,
		},
	});

	expect(res.statusCode).toBe(400);
});

test("POST /v1/assets returns 409 for duplicate asset-type serial numbers", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/assets",
		headers: { cookie: cityManager.cookie },
		body: {
			asset_type_id: clientAssetTypeId,
			serial_number: "client-visible-asset",
			creation_date: "2026-02-04T00:00:00.000Z",
			gauge_station_id: 1,
		},
	});

	expect(res.statusCode).toBe(409);
});

test("PATCH /v1/assets/:id updates a same-client asset", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/assets/${createdAssetId}`,
		headers: { cookie: cityManager.cookie },
		body: { serial_number: "client-created-updated", cost: null },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<AssetBody>()).toEqual(
		expect.objectContaining({ id: createdAssetId, serial_number: "client-created-updated", cost: null }),
	);
});

test("PATCH /v1/assets/:id hides another client's asset from client writers", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/assets/${externalAssetId}`,
		headers: { cookie: cityManager.cookie },
		body: { serial_number: "should-not-update" },
	});

	expect(res.statusCode).toBe(404);
});

test("DELETE /v1/assets/:id removes a same-client asset", async () => {
	const res = await app.inject({
		method: "DELETE",
		url: `/v1/assets/${createdAssetId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(204);
	const deleted = await db.pool.query<{ id: number }>(`SELECT id FROM asset WHERE id = $1`, [createdAssetId]);
	expect(deleted.rows).toEqual([]);
});
