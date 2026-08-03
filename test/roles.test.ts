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
let cityTechnician: TestUserSession;
let deletableRoleId: number;

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "roles-admin@example.com",
		name: "Roles Admin",
		client_id: 1,
		role_id: 1,
	});
	cityManager = await signUpTestUser(app, {
		email: "roles-city-manager@example.com",
		name: "Roles City Manager",
		client_id: 2,
		role_id: 3,
	});
	cityTechnician = await signUpTestUser(app, {
		email: "roles-city-tech@example.com",
		name: "Roles City Tech",
		client_id: 2,
		role_id: 4,
	});

	const role = await db.pool.query<{ id: number }>(
		`INSERT INTO role (name, client_id) VALUES ('DELETE_ME', 2) RETURNING id`,
	);
	deletableRoleId = role.rows[0]!.id;
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

interface RoleBody {
	id: number;
	name: string;
	client_id: number;
    deleted_at: string | null;
	permissions: Array<{ id: number; name: string; assign_role: boolean }>;
}

interface RoleListBody {
	data: RoleBody[];
}

interface PermissionListBody {
	data: Array<{ id: number; name: string; assign_role: boolean }>;
}

test("GET /v1/roles returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/roles" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/roles lets admins see all roles", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/roles",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<RoleListBody>();
	expect(body.data.map((role) => role.id)).toEqual(expect.arrayContaining([1, 2, 3, 4]));
});

test("GET /v1/roles limits client managers to their client", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/roles",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<RoleListBody>();
	expect(body.data.every((role) => role.client_id === 2)).toBe(true);
	expect(body.data.map((role) => role.id)).toEqual(expect.arrayContaining([3, 4]));
	expect(body.data.map((role) => role.id)).not.toContain(1);
});

test("GET /v1/roles/permissions lets admins see all permissions", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/roles/permissions",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<PermissionListBody>();
	expect(body.data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: 12, name: "W_EXTERNAL_USERS", assign_role: true }),
			expect.objectContaining({ id: 29, name: "EX_CLIENT_VOTES", assign_role: false }),
		]),
	);
});

test("GET /v1/roles/permissions limits client managers to assignable permissions they hold", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/roles/permissions",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<PermissionListBody>();
	const permissionNames = body.data.map((permission) => permission.name);
	expect(permissionNames).toContain("R_CLIENT_USERS");
	expect(permissionNames).toContain("W_CLIENT_USERS");
	expect(permissionNames).not.toContain("R_EXTERNAL_USERS");
	expect(permissionNames).not.toContain("W_EXTERNAL_USERS");
	expect(permissionNames).not.toContain("EX_CLIENT_VOTES");
	expect(body.data.every((permission) => permission.assign_role)).toBe(true);
});

test("GET /v1/roles/:id returns a visible role with permissions", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/roles/4",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<RoleBody>()).toEqual(
		expect.objectContaining({
			id: 4,
			client_id: 2,
			permissions: expect.arrayContaining([expect.objectContaining({ id: 2 })]),
		}),
	);
});

test("GET /v1/roles/:id hides another client's role from a client manager", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/roles/1",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("POST /v1/roles lets a client manager create a lower role in their client", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/roles",
		headers: { cookie: cityManager.cookie },
		body: { name: "FIELD_VIEWER", client_id: 2, permission_ids: [1, 5] },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<RoleBody>()).toEqual(
		expect.objectContaining({
			name: "FIELD_VIEWER",
			client_id: 2,
			permissions: expect.arrayContaining([
				expect.objectContaining({ id: 1 }),
				expect.objectContaining({ id: 5 }),
			]),
		}),
	);
});

test("POST /v1/roles rejects assigning non-role permissions", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/roles",
		headers: { cookie: cityManager.cookie },
		body: { name: "BAD_ROLE", client_id: 2, permission_ids: [29] },
	});

	expect(res.statusCode).toBe(400);
});

test("POST /v1/roles rejects a client manager creating for another client", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/roles",
		headers: { cookie: cityManager.cookie },
		body: { name: "OTHER_CLIENT", client_id: 1, permission_ids: [1] },
	});

	expect(res.statusCode).toBe(403);
});

test("POST /v1/roles rejects a technician", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/roles",
		headers: { cookie: cityTechnician.cookie },
		body: { name: "NOPE", client_id: 2, permission_ids: [1] },
	});

	expect(res.statusCode).toBe(403);
});

test("PATCH /v1/roles/:id renames a same-client role", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/roles/${deletableRoleId}`,
		headers: { cookie: cityManager.cookie },
		body: { name: "DELETE_ME_RENAMED" },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<RoleBody>()).toEqual(
		expect.objectContaining({ id: deletableRoleId, name: "DELETE_ME_RENAMED" }),
	);
});

test("PUT /v1/roles/:id/permissions replaces role permissions", async () => {
	const res = await app.inject({
		method: "PUT",
		url: `/v1/roles/${deletableRoleId}/permissions`,
		headers: { cookie: cityManager.cookie },
		body: { permission_ids: [1, 5] },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<RoleBody>().permissions.map((permission) => permission.id)).toEqual([1, 5]);
});

test("DELETE /v1/roles/:id returns 409 for a role with users", async () => {
	const res = await app.inject({
		method: "DELETE",
		url: "/v1/roles/4",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(409);
	expect(res.json<{ error: string; message: string }>().error).toBe("Conflict");
});

test("DELETE /v1/roles/:id deletes an unused same-client role", async () => {
	const res = await app.inject({
		method: "DELETE",
		url: `/v1/roles/${deletableRoleId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(204);
	expect(res.body).toBe("");
});
