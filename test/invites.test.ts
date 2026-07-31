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
let adminInviteId: number;
let cityInviteId: number;
let cityPermalinkToken: string;
let deleteTargetInviteId: number;

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "invites-admin@example.com",
		name: "Invites Admin",
		client_id: 1,
		role_id: 1,
	});
	cityManager = await signUpTestUser(app, {
		email: "invites-city-manager@example.com",
		name: "Invites City Manager",
		client_id: 2,
		role_id: 3,
	});
	cityTechnician = await signUpTestUser(app, {
		email: "invites-city-tech@example.com",
		name: "Invites City Tech",
		client_id: 2,
		role_id: 4,
	});

	const invites = await db.pool.query<{ id: number; token: string }>(
		`INSERT INTO invite (token, expires_at, sender_user_id, client_id, role_id)
		 VALUES
		   ('admin-client-one', now() + interval '1 day', $1, 1, 2),
		   ('city-client-two', now() + interval '1 day', $2, 2, 4),
		   ('city-permalink', NULL, $2, 2, 4),
		   ('delete-target', now() + interval '1 day', $2, 2, 4)
		 RETURNING id, token`,
		[admin.id, cityManager.id],
	);

	adminInviteId = invites.rows.find((invite) => invite.token === "admin-client-one")!.id;
	cityInviteId = invites.rows.find((invite) => invite.token === "city-client-two")!.id;
	cityPermalinkToken = "city-permalink";
	deleteTargetInviteId = invites.rows.find((invite) => invite.token === "delete-target")!.id;

	await db.pool.query(
		`INSERT INTO accepted_invites (invite_id, user_id)
		 VALUES ($1, $2), ($3, $4)`,
		[adminInviteId, admin.id, cityInviteId, cityTechnician.id],
	);
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

interface InviteBody {
	id: number;
	token: string;
	expires_at: string | null;
	sender_user_id: string;
	client_id: number;
	role_id: number;
}

interface InviteListBody {
	data: InviteBody[];
}

interface AcceptedInviteListBody {
	data: Array<{ invite_id: number; user_id: string; sender_user_id: string }>;
}

test("GET /v1/invites returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/invites" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/invites lets external admins see every invite", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/invites",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<InviteListBody>();
	expect(body.data.map((invite) => invite.token)).toEqual(
		expect.arrayContaining(["admin-client-one", "city-client-two", "city-permalink"]),
	);
});

test("GET /v1/invites limits client managers to invites for their client", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/invites",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<InviteListBody>();
	expect(body.data.map((invite) => invite.token)).toEqual(
		expect.arrayContaining(["city-client-two", "city-permalink"]),
	);
	expect(body.data.every((invite) => invite.client_id === 2)).toBe(true);
	expect(body.data.map((invite) => invite.token)).not.toContain("admin-client-one");
});

test("POST /v1/invites lets an external admin create an invite for any client", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/invites",
		headers: { cookie: admin.cookie },
		body: { client_id: 2, role_id: 4, expires_at: null },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<InviteBody>()).toEqual(
		expect.objectContaining({
			sender_user_id: admin.id,
			client_id: 2,
			role_id: 4,
			expires_at: null,
		}),
	);
});

test("POST /v1/invites lets a client manager invite a lower role in their client", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/invites",
		headers: { cookie: cityManager.cookie },
		body: { client_id: 2, role_id: 4, expires_at: "2026-12-31T23:59:59.000Z" },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<InviteBody>()).toEqual(
		expect.objectContaining({ sender_user_id: cityManager.id, client_id: 2, role_id: 4 }),
	);
});

test("POST /v1/invites rejects a client manager inviting another client manager", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/invites",
		headers: { cookie: cityManager.cookie },
		body: { client_id: 2, role_id: 3, expires_at: null },
	});

	expect(res.statusCode).toBe(403);
});

test("POST /v1/invites rejects a client manager inviting another client", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/invites",
		headers: { cookie: cityManager.cookie },
		body: { client_id: 1, role_id: 2, expires_at: null },
	});

	expect(res.statusCode).toBe(403);
});

test("GET /v1/invites/validate returns null expires_at for a permalink", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/invites/validate?token=${cityPermalinkToken}`,
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ expires_at: string | null }>()).toEqual({ expires_at: null });
});

test("POST /v1/invites/accept creates a user from an invite", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/invites/accept",
		body: {
			token: cityPermalinkToken,
			email: "accepted-invite-user@example.com",
			name: "Accepted Invite User",
			password: "correct-horse-battery-staple",
			phone_number: "+15555550200",
		},
	});

	expect(res.statusCode).toBe(201);
	expect(
		res.json<{ email: string; client_id: number; role_id: number; phone_number: string }>(),
	).toEqual(
		expect.objectContaining({
			email: "accepted-invite-user@example.com",
			client_id: 2,
			role_id: 4,
			phone_number: "+15555550200",
		}),
	);
});

test("POST /v1/invites/accept rejects an email that already exists", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/invites/accept",
		body: {
			token: cityPermalinkToken,
			email: "accepted-invite-user@example.com",
			name: "Duplicate Invite User",
			password: "correct-horse-battery-staple",
			phone_number: "+15555550201",
		},
	});

	expect(res.statusCode).toBe(409);
});

test("GET /v1/invites/accepted lets admins see accepted invites for all clients", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/invites/accepted",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<AcceptedInviteListBody>();
	expect(body.data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ invite_id: adminInviteId, sender_user_id: admin.id }),
			expect.objectContaining({ invite_id: cityInviteId, sender_user_id: cityManager.id }),
		]),
	);
});

test("GET /v1/invites/accepted limits client managers to their client", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/invites/accepted",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<AcceptedInviteListBody>();
	expect(body.data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ invite_id: cityInviteId, sender_user_id: cityManager.id }),
		]),
	);
	expect(body.data.map((invite) => invite.invite_id)).not.toContain(adminInviteId);
});

test("DELETE /v1/invites/:id deletes an unaccepted same-client invite", async () => {
	const res = await app.inject({
		method: "DELETE",
		url: `/v1/invites/${deleteTargetInviteId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<InviteBody>()).toEqual(
		expect.objectContaining({ id: deleteTargetInviteId, client_id: 2 }),
	);
});

test("DELETE /v1/invites/:id returns 409 for an accepted invite", async () => {
	const res = await app.inject({
		method: "DELETE",
		url: `/v1/invites/${cityInviteId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(409);
});

test("DELETE /v1/invites/:id hides another client's invite from a client manager", async () => {
	const res = await app.inject({
		method: "DELETE",
		url: `/v1/invites/${adminInviteId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});
