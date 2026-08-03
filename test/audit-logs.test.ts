import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import { startTestDatabase, stubConfigEnv, type TestDatabase } from "./helpers/database";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;

// Torres ADMIN (client 1, role 1): external control-panel and users perms — sees everything.
let admin: TestUserSession;
// Bryan CLIENT_MANAGER (client 2, role 3): client-scoped control-panel and users perms.
let manager: TestUserSession;
// Torres TECHNICIAN (client 1, role 2): holds neither W_CLIENT_USERS nor
// W_EXTERNAL_USERS — used to exercise 403s.
let torresTech: TestUserSession;

let deviceId: number;

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	// The device table is a placeholder (id only) and ships unseeded.
	const device = await db.pool.query<{ id: number }>(
		"INSERT INTO device (serial_number) VALUES ('audit-test-device') RETURNING id",
	);
	const deviceRow = device.rows[0];
	if (!deviceRow) throw new Error("device insert returned no row");
	deviceId = deviceRow.id;

	admin = await signUpTestUser(app, {
		email: "audit-admin@example.com",
		name: "Audit Admin",
		client_id: 1,
		role_id: 1,
	});
	manager = await signUpTestUser(app, {
		email: "audit-city-manager@example.com",
		name: "Audit City Manager",
		client_id: 2,
		role_id: 3,
	});
	torresTech = await signUpTestUser(app, {
		email: "audit-torres-tech@example.com",
		name: "Audit Torres Tech",
		client_id: 1,
		role_id: 2,
	});
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

const collections = ["control", "users", "roles-perms"] as const;

test("every audit-log route returns 401 without a session", async () => {
	// POST bodies must pass schema validation: Fastify validates before
	// preHandler runs, so an invalid body would 400 before the auth check.
	const requests: Array<{
		method: "GET" | "POST";
		url: string;
		body?: Record<string, string | number>;
	}> = [
		{ method: "GET", url: "/v1/audit-logs/actions" },
		...collections.map((c) => ({ method: "GET" as const, url: `/v1/audit-logs/${c}` })),
		{
			method: "POST",
			url: "/v1/audit-logs/control",
			body: { action: "WIFI_ON", device_id: 1 },
		},
		{
			method: "POST",
			url: "/v1/audit-logs/users",
			body: { action: "DELETE_USER", target_id: "someone" },
		},
		{
			method: "POST",
			url: "/v1/audit-logs/roles-perms",
			body: { action: "CREATE_ROLE", role_id: 1 },
		},
	];

	for (const { method, url, body } of requests) {
		const res = await app.inject({ method, url, body });
		expect(res.statusCode).toBe(401);
	}
});

test("audit logs cannot be updated or deleted — no such routes exist", async () => {
	for (const collection of collections) {
		for (const method of ["PUT", "PATCH", "DELETE"] as const) {
			for (const url of [`/v1/audit-logs/${collection}`, `/v1/audit-logs/${collection}/1`]) {
				const res = await app.inject({
					method,
					url,
					headers: { cookie: admin.cookie },
					body: {},
				});
				expect(res.statusCode).toBe(404);
			}
		}
	}
});

test("GET /v1/audit-logs/actions lists the seeded action registry", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/audit-logs/actions",
		headers: { cookie: admin.cookie },
	});
	expect(res.statusCode).toBe(200);
	const body = res.json<{ data: Array<{ id: number; action: string; action_text: string }> }>();
	expect(body.data).toHaveLength(23);
	expect(body.data[0]).toEqual({ id: 1, action: "WIFI_ON", action_text: "Wifi On" });
});

test("POST /v1/audit-logs/control creates a log entry with the session user as actor", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/audit-logs/control",
		headers: { cookie: manager.cookie },
		body: { action: "WIFI_ON", device_id: deviceId },
	});
	expect(res.statusCode).toBe(201);
	const body = res.json<{
		id: number;
		date: string;
		action: string;
		action_text: string;
		device_id: number;
		actor_user_id: string;
	}>();
	expect(body.action).toBe("WIFI_ON");
	expect(body.action_text).toBe("Wifi On");
	expect(body.device_id).toBe(deviceId);
	// The actor is the session user — creating a log as someone else is impossible.
	expect(body.actor_user_id).toBe(manager.id);
	expect(Date.parse(body.date)).not.toBeNaN();
});

test("POST /v1/audit-logs/control rejects unknown actions and devices with 400", async () => {
	const unknownAction = await app.inject({
		method: "POST",
		url: "/v1/audit-logs/control",
		headers: { cookie: manager.cookie },
		body: { action: "NOT_A_REAL_ACTION", device_id: deviceId },
	});
	expect(unknownAction.statusCode).toBe(400);

	const unknownDevice = await app.inject({
		method: "POST",
		url: "/v1/audit-logs/control",
		headers: { cookie: manager.cookie },
		body: { action: "WIFI_ON", device_id: 9999 },
	});
	expect(unknownDevice.statusCode).toBe(400);
});

test("GET /v1/audit-logs/control scopes client readers to their own client", async () => {
	// A second entry by the Torres admin (client 1).
	const created = await app.inject({
		method: "POST",
		url: "/v1/audit-logs/control",
		headers: { cookie: admin.cookie },
		body: { action: "PING", device_id: deviceId },
	});
	expect(created.statusCode).toBe(201);

	// The Bryan manager reads client-scoped: only the entry by their own client's user.
	const managerList = await app.inject({
		method: "GET",
		url: "/v1/audit-logs/control",
		headers: { cookie: manager.cookie },
	});
	expect(managerList.statusCode).toBe(200);
	const managerRows = managerList.json<{ data: Array<{ actor_user_id: string }> }>().data;
	expect(managerRows).toHaveLength(1);
	expect(managerRows[0]?.actor_user_id).toBe(manager.id);

	// The admin reads external: both entries, newest first.
	const adminList = await app.inject({
		method: "GET",
		url: "/v1/audit-logs/control",
		headers: { cookie: admin.cookie },
	});
	expect(adminList.statusCode).toBe(200);
	const adminRows = adminList.json<{ data: Array<{ action: string }> }>().data;
	expect(adminRows).toHaveLength(2);
	expect(adminRows[0]?.action).toBe("PING");
	expect(adminRows[1]?.action).toBe("WIFI_ON");
});

test("GET /v1/audit-logs/control supports action and time-range filters", async () => {
	const byAction = await app.inject({
		method: "GET",
		url: "/v1/audit-logs/control?action=WIFI_ON",
		headers: { cookie: admin.cookie },
	});
	expect(byAction.statusCode).toBe(200);
	const rows = byAction.json<{ data: Array<{ action: string }> }>().data;
	expect(rows).toHaveLength(1);
	expect(rows[0]?.action).toBe("WIFI_ON");

	// A window that ends before any entry was written matches nothing.
	const empty = await app.inject({
		method: "GET",
		url: "/v1/audit-logs/control?to=2000-01-01T00:00:00.000Z",
		headers: { cookie: admin.cookie },
	});
	expect(empty.statusCode).toBe(200);
	expect(empty.json<{ data: unknown[] }>().data).toHaveLength(0);
});

test("POST /v1/audit-logs/users returns 403 without a user-write permission", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/audit-logs/users",
		headers: { cookie: torresTech.cookie },
		body: { action: "UPDATE_USER", target_id: torresTech.id },
	});
	expect(res.statusCode).toBe(403);
});

test("POST /v1/audit-logs/users scopes client writers to targets in their own client", async () => {
	// Cross-client target reads as nonexistent (400), not forbidden — no
	// leaking which user ids exist elsewhere.
	const crossClient = await app.inject({
		method: "POST",
		url: "/v1/audit-logs/users",
		headers: { cookie: manager.cookie },
		body: { action: "UPDATE_USER", target_id: admin.id },
	});
	expect(crossClient.statusCode).toBe(400);

	const ownClient = await app.inject({
		method: "POST",
		url: "/v1/audit-logs/users",
		headers: { cookie: manager.cookie },
		body: { action: "UPDATE_USER", target_id: manager.id },
	});
	expect(ownClient.statusCode).toBe(201);
	const body = ownClient.json<{ actor_user_id: string; target_user_id: string; action: string }>();
	expect(body.actor_user_id).toBe(manager.id);
	expect(body.target_user_id).toBe(manager.id);
	expect(body.action).toBe("UPDATE_USER");
});

test("GET /v1/audit-logs/users scopes client readers by the target's client", async () => {
	const managerList = await app.inject({
		method: "GET",
		url: "/v1/audit-logs/users",
		headers: { cookie: manager.cookie },
	});
	expect(managerList.statusCode).toBe(200);
	const rows = managerList.json<{ data: Array<{ target_user_id: string }> }>().data;
	expect(rows).toHaveLength(1);
	expect(rows[0]?.target_user_id).toBe(manager.id);
});

test("POST /v1/audit-logs/roles-perms scopes client writers to their own client's roles", async () => {
	// Role 1 belongs to client 1; the Bryan manager cannot reference it.
	const crossClient = await app.inject({
		method: "POST",
		url: "/v1/audit-logs/roles-perms",
		headers: { cookie: manager.cookie },
		body: { action: "CREATE_ROLE", role_id: 1 },
	});
	expect(crossClient.statusCode).toBe(400);

	// Role 3 is the manager's own client's role.
	const ownClient = await app.inject({
		method: "POST",
		url: "/v1/audit-logs/roles-perms",
		headers: { cookie: manager.cookie },
		body: { action: "UPDATE_ROLE_PERMISSIONS", role_id: 3, permission_id: 9, added: true },
	});
	expect(ownClient.statusCode).toBe(201);
	const body = ownClient.json<{
		action: string;
		role_name: string;
		permission_id: number | null;
		added: boolean | null;
	}>();
	expect(body.action).toBe("UPDATE_ROLE_PERMISSIONS");
	expect(body.role_name).toBe("CLIENT_MANAGER");
	expect(body.permission_id).toBe(9);
	expect(body.added).toBe(true);
});

test("POST /v1/audit-logs/roles-perms accepts role-only entries with null extras", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/audit-logs/roles-perms",
		headers: { cookie: admin.cookie },
		body: { action: "DELETE_ROLE", role_id: 4 },
	});
	expect(res.statusCode).toBe(201);
	const body = res.json<{ role_name: string; permission_id: null; added: boolean }>();
	expect(body.role_name).toBe("TECHNICIAN");
	expect(body.permission_id).toBeNull();
	expect(body.added).toBe(false);
});


