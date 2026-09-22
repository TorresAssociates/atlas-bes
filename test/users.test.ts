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
let deleteTarget: TestUserSession;
let adminDeleteTarget: TestUserSession;
let technicianDeleteTarget: TestUserSession;

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "users-admin@example.com",
		name: "Users Admin",
		client_id: 1,
		role_id: 1,
	});
	cityManager = await signUpTestUser(app, {
		email: "users-city-manager@example.com",
		name: "Users City Manager",
		client_id: 2,
		role_id: 3,
	});
	cityTechnician = await signUpTestUser(app, {
		email: "users-city-tech@example.com",
		name: "Users City Tech",
		client_id: 2,
		role_id: 4,
	});
	deleteTarget = await signUpTestUser(app, {
		email: "users-delete-target@example.com",
		name: "Users Delete Target",
		client_id: 2,
		role_id: 4,
	});
	adminDeleteTarget = await signUpTestUser(app, {
		email: "users-admin-delete-target@example.com",
		name: "Users Admin Delete Target",
		client_id: 2,
		role_id: 4,
	});
	technicianDeleteTarget = await signUpTestUser(app, {
		email: "users-technician-delete-target@example.com",
		name: "Users Technician Delete Target",
		client_id: 2,
		role_id: 4,
	});
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

interface UserBody {
	id: string;
	email: string;
	client_id: number;
	role_id: number;
	phone_number: string | null;
	phone_number_verified: boolean;
	deleted_at: string | null;
}

interface UserListBody {
	data: UserBody[];
}

interface UserMeBody {
	user: UserBody;
	permissions: string[];
}

async function latestUserAuditLog(targetUserId: string) {
	const audit = await db.pool.query<{
		action_id: string;
		actor_user_id: string;
		target_user_id: string;
	}>(
		`SELECT audit_log_action.action_id, user_audit_log.actor_user_id, user_audit_log.target_user_id
		 FROM user_audit_log
		 INNER JOIN audit_log_action ON audit_log_action.id = user_audit_log.log_action_id
		 WHERE user_audit_log.target_user_id = $1
		 ORDER BY user_audit_log.id DESC
		 LIMIT 1`,
		[targetUserId],
	);

	return audit.rows[0];
}

test("GET /v1/users returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/users" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/users/me returns current user and permissions", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/users/me",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<UserMeBody>();
	expect(body.user).toEqual(expect.objectContaining({ id: cityManager.id, client_id: 2 }));
	expect(body.permissions).toContain("R_CLIENT_USERS");
	expect(body.permissions).not.toContain("R_EXTERNAL_USERS");
});

test("GET /v1/users/me returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/users/me" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/users lets external admins see users from every client", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/users",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<UserListBody>();
	expect(body.data.map((user) => user.id)).toContain(admin.id);
	expect(body.data.map((user) => user.id)).toContain(cityManager.id);
	expect(body.data.map((user) => user.id)).toContain(cityTechnician.id);
});

test("GET /v1/users limits client managers to users in their client", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/users",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<UserListBody>();
	expect(body.data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: cityManager.id, client_id: 2 }),
			expect.objectContaining({ id: cityTechnician.id, client_id: 2 }),
		]),
	);
	expect(body.data.every((user) => user.client_id === 2)).toBe(true);
	expect(body.data.map((user) => user.id)).not.toContain(admin.id);
});

test("GET /v1/users/me returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/users/me" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/users/me returns the caller's profile with names and permissions", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/users/me",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<{
		user: UserBody;
		client_name: string;
		role_name: string;
		permissions: string[];
	}>();
	expect(body.user.id).toBe(admin.id);
	expect(body.client_name).toBe("Torres & Associates");
	expect(body.role_name).toBe("ADMIN");
	expect(body.permissions).toContain("R_EXTERNAL_USERS");
});

test("GET /v1/users/me scopes to the caller, not their client's other users", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/users/me",
		headers: { cookie: cityTechnician.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<{
		user: UserBody;
		client_name: string;
		role_name: string;
		permissions: string[];
	}>();
	expect(body.user.id).toBe(cityTechnician.id);
	expect(body.client_name).toBe("City of Bryan");
	expect(body.role_name).toBe("TECHNICIAN");
	expect(body.permissions).not.toContain("R_EXTERNAL_USERS");
});

test("GET /v1/users/:id returns a same-client user for a client manager", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/users/${cityTechnician.id}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<UserBody>()).toEqual(
		expect.objectContaining({ id: cityTechnician.id, client_id: 2 }),
	);
});

test("GET /v1/users/:id returns an any-client user for an admin", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/users/${cityTechnician.id}`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<UserBody>()).toEqual(
		expect.objectContaining({ id: cityTechnician.id, client_id: 2 }),
	);
});

test("GET /v1/users/:id hides another client's user from a client manager", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/users/${admin.id}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("PATCH /v1/users/me/phone-number updates the current user's phone number", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: "/v1/users/me/phone-number",
		headers: { cookie: cityManager.cookie },
		body: { phone_number: "+15555550100" },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<UserBody>()).toEqual(
		expect.objectContaining({
			id: cityManager.id,
			phone_number: "+15555550100",
			phone_number_verified: false,
		}),
	);
	expect(await latestUserAuditLog(cityManager.id)).toEqual(
		expect.objectContaining({
			action_id: "UPDATE_USER",
			actor_user_id: cityManager.id,
			target_user_id: cityManager.id,
		}),
	);
});

test("PATCH /v1/users/:id lets a client manager update a same-client user's phone number", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/${cityTechnician.id}`,
		headers: { cookie: cityManager.cookie },
		body: { phone_number: "+15555550101" },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<UserBody>()).toEqual(
		expect.objectContaining({ id: cityTechnician.id, phone_number: "+15555550101" }),
	);
	expect(await latestUserAuditLog(cityTechnician.id)).toEqual(
		expect.objectContaining({
			action_id: "UPDATE_USER",
			actor_user_id: cityManager.id,
			target_user_id: cityTechnician.id,
		}),
	);
});

test("PATCH /v1/users/:id lets an admin update any user's phone number", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/${cityTechnician.id}`,
		headers: { cookie: admin.cookie },
		body: { phone_number: "+15555550101" },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<UserBody>()).toEqual(
		expect.objectContaining({ id: cityTechnician.id, phone_number: "+15555550101" }),
	);
});

test("PATCH /v1/users/:id hides another client's user from a client manager", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/${admin.id}`,
		headers: { cookie: cityManager.cookie },
		body: { phone_number: "+15555550102" },
	});

	expect(res.statusCode).toBe(404);
});

test("PATCH /v1/users/delete/:id soft-deletes a same-client user as a client manager", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/delete/${deleteTarget.id}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<UserBody>();
	expect(body.id).toBe(deleteTarget.id);
	expect(body.deleted_at).not.toBeNull();
	expect(body.phone_number).toBeNull();
	expect(await latestUserAuditLog(deleteTarget.id)).toEqual(
		expect.objectContaining({
			action_id: "DELETE_USER",
			actor_user_id: cityManager.id,
			target_user_id: deleteTarget.id,
		}),
	);
});

test("PATCH /v1/users/delete/:id soft-deletes any user as an admin", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/delete/${adminDeleteTarget.id}`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<UserBody>();
	expect(body.id).toBe(adminDeleteTarget.id);
	expect(body.deleted_at).not.toBeNull();
	expect(body.phone_number).toBeNull();
});

test("PATCH /v1/users/delete/:id returns 403 when a technician soft-deletes a same-client user", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/delete/${technicianDeleteTarget.id}`,
		headers: { cookie: cityTechnician.cookie },
	});

	expect(res.statusCode).toBe(403);

	const user = await db.pool.query<{ deleted_at: Date | null }>(
		`SELECT deleted_at FROM "user" WHERE id = $1`,
		[technicianDeleteTarget.id],
	);
	expect(user.rows[0]?.deleted_at).toBeNull();
});

test("PATCH /v1/users/delete/:id returns 409 when the user is already deleted", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/delete/${deleteTarget.id}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(409);
});

// ---------------------------------------------------------------------------
// Access management: PATCH /:id/role, GET|PUT /:id/permissions
// ---------------------------------------------------------------------------

interface UserPermissionsBody {
	role: { id: number; name: string; permissions: { id: number; name: string }[] } | null;
	granted: { id: number; name: string }[];
	grantable: { id: number; name: string }[];
}

let lowerRoleId: number;

test("PATCH /v1/users/:id/role lets a client manager move a user to a lower same-client role", async () => {
	const created = await app.inject({
		method: "POST",
		url: "/v1/roles",
		headers: { cookie: cityManager.cookie },
		body: { name: "USERS_TEST_VIEWER", client_id: 2, permission_ids: [1] },
	});
	expect(created.statusCode).toBe(201);
	lowerRoleId = created.json<{ id: number }>().id;

	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/${cityTechnician.id}/role`,
		headers: { cookie: cityManager.cookie },
		body: { role_id: lowerRoleId },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<UserBody>()).toEqual(
		expect.objectContaining({ id: cityTechnician.id, role_id: lowerRoleId }),
	);
	expect(await latestUserAuditLog(cityTechnician.id)).toEqual(
		expect.objectContaining({ action_id: "UPDATE_USER", actor_user_id: cityManager.id }),
	);

	const restore = await app.inject({
		method: "PATCH",
		url: `/v1/users/${cityTechnician.id}/role`,
		headers: { cookie: cityManager.cookie },
		body: { role_id: 4 },
	});
	expect(restore.statusCode).toBe(200);
});

test("PATCH /v1/users/:id/role rejects promoting a user to the manager's own level", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/${cityTechnician.id}/role`,
		headers: { cookie: cityManager.cookie },
		body: { role_id: 3 },
	});

	expect(res.statusCode).toBe(403);
});

test("PATCH /v1/users/:id/role rejects changing your own role", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/${cityManager.id}/role`,
		headers: { cookie: cityManager.cookie },
		body: { role_id: 4 },
	});

	expect(res.statusCode).toBe(403);
});

test("PATCH /v1/users/:id/role rejects a role from another client", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/${cityTechnician.id}/role`,
		headers: { cookie: cityManager.cookie },
		body: { role_id: 2 },
	});

	expect(res.statusCode).toBe(400);
});

test("PATCH /v1/users/:id/role rejects a technician", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/users/${deleteTarget.id}/role`,
		headers: { cookie: cityTechnician.cookie },
		body: { role_id: 4 },
	});

	expect(res.statusCode).toBe(403);
});

test("PATCH /v1/users/:id/role lets an external admin bypass the hierarchy", async () => {
	const promote = await app.inject({
		method: "PATCH",
		url: `/v1/users/${cityTechnician.id}/role`,
		headers: { cookie: admin.cookie },
		body: { role_id: 3 },
	});
	expect(promote.statusCode).toBe(200);
	expect(promote.json<UserBody>().role_id).toBe(3);

	const restore = await app.inject({
		method: "PATCH",
		url: `/v1/users/${cityTechnician.id}/role`,
		headers: { cookie: admin.cookie },
		body: { role_id: 4 },
	});
	expect(restore.statusCode).toBe(200);
});

test("GET /v1/users/:id/permissions returns role, grants and the caller's grantable catalog", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/users/${cityTechnician.id}/permissions`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<UserPermissionsBody>();
	expect(body.role).toEqual(expect.objectContaining({ id: 4, name: "TECHNICIAN" }));
	expect(body.role?.permissions.map((p) => p.id)).toContain(1);
	expect(body.granted).toEqual([]);

	const grantable = body.grantable.map((p) => p.name);
	expect(grantable).toContain("R_CLIENT_USERS");
	expect(grantable).not.toContain("R_EXTERNAL_USERS");
	// EX_CLIENT_VOTES is not held by the manager's role, so not grantable by them.
	expect(grantable).not.toContain("EX_CLIENT_VOTES");
});

test("GET /v1/users/:id/permissions gives external admins the full catalog", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/users/${cityTechnician.id}/permissions`,
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const grantable = res.json<UserPermissionsBody>().grantable.map((p) => p.name);
	expect(grantable).toContain("W_EXTERNAL_USERS");
	expect(grantable).toContain("EX_CLIENT_VOTES");
});

test("GET /v1/users/:id/permissions hides another client's user from a client manager", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/users/${admin.id}/permissions`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("PUT /v1/users/:id/permissions replaces individual grants and takes effect immediately", async () => {
	const res = await app.inject({
		method: "PUT",
		url: `/v1/users/${cityTechnician.id}/permissions`,
		headers: { cookie: cityManager.cookie },
		body: { permission_ids: [9, 9] },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<UserPermissionsBody>().granted.map((p) => p.id)).toEqual([9]);
	expect(await latestUserAuditLog(cityTechnician.id)).toEqual(
		expect.objectContaining({ action_id: "UPDATE_USER", actor_user_id: cityManager.id }),
	);

	const me = await app.inject({
		method: "GET",
		url: "/v1/users/me",
		headers: { cookie: cityTechnician.cookie },
	});
	expect(me.json<UserMeBody>().permissions).toContain("R_CLIENT_USERS");

	const cleared = await app.inject({
		method: "PUT",
		url: `/v1/users/${cityTechnician.id}/permissions`,
		headers: { cookie: cityManager.cookie },
		body: { permission_ids: [] },
	});
	expect(cleared.statusCode).toBe(200);
	expect(cleared.json<UserPermissionsBody>().granted).toEqual([]);
});

test("PUT /v1/users/:id/permissions rejects granting a permission the manager lacks", async () => {
	// EX_CLIENT_VOTES (29) is client-scoped but not held by the CLIENT_MANAGER role.
	const res = await app.inject({
		method: "PUT",
		url: `/v1/users/${cityTechnician.id}/permissions`,
		headers: { cookie: cityManager.cookie },
		body: { permission_ids: [29] },
	});

	expect(res.statusCode).toBe(403);
});

test("PUT /v1/users/:id/permissions rejects grants that would equal the manager's access", async () => {
	// TECHNICIAN (City of Bryan) + every remaining CLIENT_MANAGER permission.
	const res = await app.inject({
		method: "PUT",
		url: `/v1/users/${cityTechnician.id}/permissions`,
		headers: { cookie: cityManager.cookie },
		body: { permission_ids: [9, 10, 23, 24, 27, 28] },
	});

	expect(res.statusCode).toBe(403);
});

test("PUT /v1/users/:id/permissions rejects unknown permission ids", async () => {
	const res = await app.inject({
		method: "PUT",
		url: `/v1/users/${cityTechnician.id}/permissions`,
		headers: { cookie: cityManager.cookie },
		body: { permission_ids: [999] },
	});

	expect(res.statusCode).toBe(400);
});

test("PUT /v1/users/:id/permissions rejects editing your own grants", async () => {
	const res = await app.inject({
		method: "PUT",
		url: `/v1/users/${cityManager.id}/permissions`,
		headers: { cookie: cityManager.cookie },
		body: { permission_ids: [] },
	});

	expect(res.statusCode).toBe(403);
});

test("PUT /v1/users/:id/permissions never grants external permissions outside the internal client", async () => {
	// Admin bypasses the hierarchy, but R_EXTERNAL_USERS (11) is still off-limits for a City of Bryan user.
	const res = await app.inject({
		method: "PUT",
		url: `/v1/users/${cityTechnician.id}/permissions`,
		headers: { cookie: admin.cookie },
		body: { permission_ids: [11] },
	});

	expect(res.statusCode).toBe(400);
	expect(res.json<{ message: string }>().message).toContain("R_EXTERNAL_USERS");
});

test("PUT /v1/users/:id/permissions treats R_CLIENTS / W_CLIENTS as internal-only too", async () => {
	const res = await app.inject({
		method: "PUT",
		url: `/v1/users/${cityTechnician.id}/permissions`,
		headers: { cookie: admin.cookie },
		body: { permission_ids: [13, 14] },
	});

	expect(res.statusCode).toBe(400);
	expect(res.json<{ message: string }>().message).toContain("R_CLIENTS");
});

test("GET /v1/users reports last login and last activity from sessions", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/users",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<{
		data: (UserBody & { last_login_at: string | null; last_active_at: string | null })[];
	}>();
	const manager = body.data.find((user) => user.id === cityManager.id);
	// Signing up created a session, so both timestamps are populated.
	expect(manager?.last_login_at).toEqual(expect.any(String));
	expect(manager?.last_active_at).toEqual(expect.any(String));
});
