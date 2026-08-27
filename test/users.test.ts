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
