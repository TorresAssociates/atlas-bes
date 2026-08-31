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
let clientWorkOrderId: number;
let externalWorkOrderId: number;
let createdWorkOrderId: number;
let createdWorkOrderUpdateId: number;

interface WorkOrderBody {
	id: number;
	name: string;
	created_at: string;
	creator_user_id: string;
	assigned_user_id: string | null;
	device_id: number;
	incident_type_id: number;
	priority: number;
	state: "not_started" | "in_progress" | "completed" | "cancelled";
	work_order_status_id: number;
}

interface WorkOrderListBody {
	data: WorkOrderBody[];
}

interface WorkOrderUpdateBody {
	id: number;
	work_order_id: number;
	date: string;
	user_id: string;
	new_priority: number;
	new_state: WorkOrderBody["state"];
	new_work_order_status_id: number;
	description: string | null;
}

interface WorkOrderUpdateListBody {
	data: WorkOrderUpdateBody[];
}

interface WorkOrderImageBody {
	id: number;
	work_order_update_id: number;
	description: string | null;
	path: string;
}

interface WorkOrderImageListBody {
	data: WorkOrderImageBody[];
}

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "work-orders-admin@example.com",
		name: "Work Orders Admin",
		client_id: 1,
		role_id: 1,
	});
	cityManager = await signUpTestUser(app, {
		email: "work-orders-manager@example.com",
		name: "Work Orders Manager",
		client_id: 2,
		role_id: 3,
	});

	const seeded = await db.pool.query<{ id: number; device_id: number }>(
		`INSERT INTO work_order
			(name, created_at, creator_user_id, device_id, incident_type_id, priority, state, work_order_status_id)
		 VALUES
			('Client work order', now(), $1, 1, 1, 1, 'not_started', 1),
			('External work order', now(), $2, 2, 2, 2, 'in_progress', 2)
		 RETURNING id, device_id`,
		[cityManager.id, admin.id],
	);
	const clientWorkOrder = seeded.rows.find((row) => row.device_id === 1);
	const externalWorkOrder = seeded.rows.find((row) => row.device_id === 2);
	if (!clientWorkOrder) throw new Error("client work order fixture was not seeded");
	if (!externalWorkOrder) throw new Error("external work order fixture was not seeded");
	clientWorkOrderId = clientWorkOrder.id;
	externalWorkOrderId = externalWorkOrder.id;
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("GET /v1/work-orders returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/work-orders" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/work-orders/statuses lists seeded statuses", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/work-orders/statuses",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ data: Array<{ id: number; status: string }> }>().data).toEqual(
		expect.arrayContaining([expect.objectContaining({ id: 1, status: "ready" })]),
	);
});

test("GET /v1/work-orders/incident-types lists seeded incident types", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/work-orders/incident-types",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ data: Array<{ id: number; type: string }> }>().data).toEqual(
		expect.arrayContaining([expect.objectContaining({ id: 1, type: "no_power" })]),
	);
});

test("GET /v1/work-orders limits client readers to their device work orders", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/work-orders",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = res.json<WorkOrderListBody>().data.map((workOrder) => workOrder.id);
	expect(ids).toContain(clientWorkOrderId);
	expect(ids).not.toContain(externalWorkOrderId);
});

test("GET /v1/work-orders lets admins see every work order", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/work-orders",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<WorkOrderListBody>().data.map((workOrder) => workOrder.id)).toEqual(
		expect.arrayContaining([clientWorkOrderId, externalWorkOrderId]),
	);
});

test("GET /v1/work-orders/:id hides another client's work order", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/work-orders/${externalWorkOrderId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("POST /v1/work-orders creates a same-client work order", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/work-orders",
		headers: { cookie: cityManager.cookie },
		body: {
			name: "Same-client repair",
			device_id: 1,
			incident_type_id: 3,
			priority: 4,
			state: "not_started",
			work_order_status_id: 3,
		},
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<WorkOrderBody>()).toEqual(
		expect.objectContaining({
			name: "Same-client repair",
			creator_user_id: cityManager.id,
			assigned_user_id: null,
			device_id: 1,
			incident_type_id: 3,
			priority: 4,
			state: "not_started",
			work_order_status_id: 3,
		}),
	);
	createdWorkOrderId = res.json<WorkOrderBody>().id;
});

test("POST /v1/work-orders rejects client writers creating for another client's device", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/work-orders",
		headers: { cookie: cityManager.cookie },
		body: {
			name: "Wrong-client repair",
			device_id: 2,
			incident_type_id: 1,
			priority: 1,
			state: "not_started",
			work_order_status_id: 1,
		},
	});

	expect(res.statusCode).toBe(400);
});

test("POST /v1/work-orders lets admins create for another client's device", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/work-orders",
		headers: { cookie: admin.cookie },
		body: {
			name: "Admin repair",
			device_id: 1,
			incident_type_id: 1,
			priority: 2,
			state: "not_started",
			work_order_status_id: 1,
		},
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<WorkOrderBody>()).toEqual(expect.objectContaining({ device_id: 1 }));
});

test("PATCH /v1/work-orders/:id updates a same-client work order", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/work-orders/${createdWorkOrderId}`,
		headers: { cookie: cityManager.cookie },
		body: { priority: 5, state: "in_progress", work_order_status_id: 2 },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<WorkOrderBody>()).toEqual(
		expect.objectContaining({
			id: createdWorkOrderId,
			priority: 5,
			state: "in_progress",
			work_order_status_id: 2,
		}),
	);
});

test("POST /v1/work-orders/:id/updates creates a history entry and moves current state", async () => {
	const res = await app.inject({
		method: "POST",
		url: `/v1/work-orders/${createdWorkOrderId}/updates`,
		headers: { cookie: cityManager.cookie },
		body: {
			new_priority: 6,
			new_state: "completed",
			new_work_order_status_id: 7,
			description: "Marked complete",
		},
	});

	expect(res.statusCode).toBe(201);
	const update = res.json<WorkOrderUpdateBody>();
	createdWorkOrderUpdateId = update.id;
	expect(update).toEqual(
		expect.objectContaining({
			work_order_id: createdWorkOrderId,
			user_id: cityManager.id,
			new_priority: 6,
			new_state: "completed",
			new_work_order_status_id: 7,
			description: "Marked complete",
		}),
	);

	const current = await app.inject({
		method: "GET",
		url: `/v1/work-orders/${createdWorkOrderId}`,
		headers: { cookie: cityManager.cookie },
	});
	expect(current.json<WorkOrderBody>()).toEqual(
		expect.objectContaining({ priority: 6, state: "completed", work_order_status_id: 7 }),
	);
});

test("GET /v1/work-orders/:id/updates lists visible work order updates", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/work-orders/${createdWorkOrderId}/updates`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<WorkOrderUpdateListBody>().data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				work_order_id: createdWorkOrderId,
				description: "Marked complete",
			}),
		]),
	);
});

test("POST /v1/work-orders/:id/images creates an image row", async () => {
	const res = await app.inject({
		method: "POST",
		url: `/v1/work-orders/${createdWorkOrderId}/images`,
		headers: { cookie: cityManager.cookie },
		body: {
			work_order_update_id: createdWorkOrderUpdateId,
			description: "Finished panel",
			path: "work-orders/finished-panel.jpg",
		},
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<WorkOrderImageBody>()).toEqual(
		expect.objectContaining({
			work_order_update_id: createdWorkOrderUpdateId,
			description: "Finished panel",
			path: "work-orders/finished-panel.jpg",
		}),
	);
});

test("GET /v1/work-orders/:id/images lists image rows", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/work-orders/${createdWorkOrderId}/images`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<WorkOrderImageListBody>().data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ path: "work-orders/finished-panel.jpg" }),
		]),
	);
});

test("DELETE /v1/work-orders/:id returns 409 while updates or images reference it", async () => {
	const res = await app.inject({
		method: "DELETE",
		url: `/v1/work-orders/${createdWorkOrderId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(409);
});

test("DELETE /v1/work-orders/:id deletes an unreferenced same-client work order", async () => {
	const created = await db.pool.query<{ id: number }>(
		`INSERT INTO work_order
			(name, created_at, creator_user_id, device_id, incident_type_id, priority, state, work_order_status_id)
		 VALUES ('Unreferenced work order', now(), $1, 1, 1, 1, 'not_started', 1)
		 RETURNING id`,
		[cityManager.id],
	);
	const createdWorkOrder = created.rows[0];
	if (!createdWorkOrder) throw new Error("work order fixture was not seeded");
	const workOrderId = createdWorkOrder.id;

	const res = await app.inject({
		method: "DELETE",
		url: `/v1/work-orders/${workOrderId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(204);
	const deleted = await db.pool.query<{ id: number }>(`SELECT id FROM work_order WHERE id = $1`, [
		workOrderId,
	]);
	expect(deleted.rows).toEqual([]);
});
