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
let createdAssetTypeId: number;
let inUseAssetTypeId: number;

interface AssetTypeBody {
	id: number;
	owner_client_id: number;
	name: string;
	lifespan: number | null;
	current_value: string | null;
	point_of_sale: string | null;
	is_deprecated: boolean;
}

interface AssetTypeListBody {
	data: AssetTypeBody[];
}

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "asset-types-admin@example.com",
		name: "Asset Types Admin",
		client_id: 1,
		role_id: 1,
	});
	cityManager = await signUpTestUser(app, {
		email: "asset-types-manager@example.com",
		name: "Asset Types Manager",
		client_id: 2,
		role_id: 3,
	});

	const seeded = await db.pool.query<{ id: number; name: string }>(
		`INSERT INTO asset_type (owner_client_id, name, lifespan, current_value, point_of_sale)
		 VALUES (2, 'client-owned-type', 36, '$120.00', 'Bryan'),
		        (1, 'external-owned-type', 48, '$240.00', 'College Station')
		 RETURNING id, name`,
	);
	clientAssetTypeId = seeded.rows.find((row) => row.name === "client-owned-type")!.id;
	externalAssetTypeId = seeded.rows.find((row) => row.name === "external-owned-type")!.id;
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("GET /v1/asset-types limits client readers to their client", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/asset-types",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<AssetTypeListBody>();
	expect(body.data.map((assetType) => assetType.id)).toContain(clientAssetTypeId);
	expect(body.data.map((assetType) => assetType.id)).not.toContain(externalAssetTypeId);
});

test("GET /v1/asset-types lets admins see all asset types", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/asset-types",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<AssetTypeListBody>().data.map((assetType) => assetType.id)).toEqual(
		expect.arrayContaining([clientAssetTypeId, externalAssetTypeId]),
	);
});

test("POST /v1/asset-types creates an asset type for the current client by default", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/asset-types",
		headers: { cookie: cityManager.cookie },
		body: {
			name: "client-created-type",
			lifespan: 24,
			current_value: "$99.00",
			point_of_sale: "Local Vendor",
		},
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<AssetTypeBody>()).toEqual(
		expect.objectContaining({
			owner_client_id: 2,
			name: "client-created-type",
			lifespan: 24,
			current_value: "$99.00",
			point_of_sale: "Local Vendor",
			is_deprecated: false,
		}),
	);
	createdAssetTypeId = res.json<AssetTypeBody>().id;
});

test("POST /v1/asset-types rejects client writers creating for another client", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/asset-types",
		headers: { cookie: cityManager.cookie },
		body: { owner_client_id: 1, name: "wrong-client-type" },
	});

	expect(res.statusCode).toBe(403);
});

test("POST /v1/asset-types lets admins create for any client", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/asset-types",
		headers: { cookie: admin.cookie },
		body: { owner_client_id: 1, name: "admin-created-type", current_value: null },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<AssetTypeBody>()).toEqual(
		expect.objectContaining({
			owner_client_id: 1,
			name: "admin-created-type",
			current_value: null,
		}),
	);
});

test("PATCH /v1/asset-types/:id updates a same-client asset type", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/asset-types/${createdAssetTypeId}`,
		headers: { cookie: cityManager.cookie },
		body: { name: "client-created-updated", is_deprecated: true, lifespan: null },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<AssetTypeBody>()).toEqual(
		expect.objectContaining({
			id: createdAssetTypeId,
			owner_client_id: 2,
			name: "client-created-updated",
			is_deprecated: true,
			lifespan: null,
		}),
	);
});

test("PATCH /v1/asset-types/:id hides another client's asset type from client writers", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/asset-types/${externalAssetTypeId}`,
		headers: { cookie: cityManager.cookie },
		body: { name: "should-not-update" },
	});

	expect(res.statusCode).toBe(404);
});

test("DELETE /v1/asset-types/:id removes an unused same-client asset type", async () => {
	const res = await app.inject({
		method: "DELETE",
		url: `/v1/asset-types/${createdAssetTypeId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(204);

	const deleted = await db.pool.query<{ id: number }>(`SELECT id FROM asset_type WHERE id = $1`, [
		createdAssetTypeId,
	]);
	expect(deleted.rows).toEqual([]);
});

test("DELETE /v1/asset-types/:id returns 409 when assets still reference the type", async () => {
	const assetType = await db.pool.query<{ id: number }>(
		`INSERT INTO asset_type (owner_client_id, name) VALUES (2, 'in-use-asset-type') RETURNING id`,
	);
	inUseAssetTypeId = assetType.rows[0]!.id;
	await db.pool.query(
		`INSERT INTO asset (asset_type_id, serial_number, creation_date, deploy_date, eos_date, gauge_station_id)
		 VALUES ($1, 'asset-type-test-serial', now(), now(), now(), 1)`,
		[inUseAssetTypeId],
	);

	const res = await app.inject({
		method: "DELETE",
		url: `/v1/asset-types/${inUseAssetTypeId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(409);
});
