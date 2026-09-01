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
let clientReportId: number;
let externalReportId: number;
let createdReportId: number;

interface SeasonalReportBody {
	id: number;
	seasonal_report_type_id: number;
	date: string;
	user_id: string;
	device_id: number;
	passed: boolean;
	note: string;
}

interface SeasonalReportListBody {
	data: SeasonalReportBody[];
}

interface SeasonalReportAnswerBody {
	id: number;
	seasonal_report_id: number;
	seasonal_report_question_id: number;
	response: "no" | "yes" | "unknown";
}

interface SeasonalReportImageBody {
	id: number;
	seasonal_report_id: number;
	description: string;
	path: string;
}

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({ pool: db.pool, logger: false });

	admin = await signUpTestUser(app, {
		email: "seasonal-reports-admin@example.com",
		name: "Seasonal Reports Admin",
		client_id: 1,
		role_id: 1,
	});
	cityManager = await signUpTestUser(app, {
		email: "seasonal-reports-manager@example.com",
		name: "Seasonal Reports Manager",
		client_id: 2,
		role_id: 3,
	});

	const seeded = await db.pool.query<{ id: number; device_id: number }>(
		`INSERT INTO seasonal_report
			(seasonal_report_type_id, date, user_id, device_id, passed, note)
		 VALUES
			(1, now(), $1, 1, true, 'client seasonal report'),
			(1, now(), $2, 2, false, 'external seasonal report')
		 RETURNING id, device_id`,
		[cityManager.id, admin.id],
	);
	clientReportId = seeded.rows.find((row) => row.device_id === 1)!.id;
	externalReportId = seeded.rows.find((row) => row.device_id === 2)!.id;
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

test("GET /v1/seasonal-reports returns 401 without a session", async () => {
	const res = await app.inject({ method: "GET", url: "/v1/seasonal-reports" });
	expect(res.statusCode).toBe(401);
});

test("GET /v1/seasonal-reports/types lists seeded report types", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/seasonal-reports/types",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ data: Array<{ id: number; report_type: string }> }>().data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: 1, report_type: "seasonalReportV1" }),
		]),
	);
});

test("GET /v1/seasonal-reports/types/:id/questions lists seeded questions for a type", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/seasonal-reports/types/1/questions",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ data: Array<{ id: number; question_text: string }> }>().data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: 1,
				question_text: "Is solar panel rated for at least 65 Watts?",
			}),
		]),
	);
});

test("GET /v1/seasonal-reports/question-categories lists seeded categories", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/seasonal-reports/question-categories",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ data: Array<{ id: number; category: string }> }>().data).toEqual(
		expect.arrayContaining([expect.objectContaining({ id: 1, category: "power_management" })]),
	);
});

test("GET /v1/seasonal-reports limits client readers to their device reports", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/seasonal-reports",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const ids = res.json<SeasonalReportListBody>().data.map((report) => report.id);
	expect(ids).toContain(clientReportId);
	expect(ids).not.toContain(externalReportId);
});

test("GET /v1/seasonal-reports lets admins see every report", async () => {
	const res = await app.inject({
		method: "GET",
		url: "/v1/seasonal-reports",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<SeasonalReportListBody>().data.map((report) => report.id)).toEqual(
		expect.arrayContaining([clientReportId, externalReportId]),
	);
});

test("GET /v1/seasonal-reports/:id hides another client's report", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/seasonal-reports/${externalReportId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(404);
});

test("POST /v1/seasonal-reports creates a same-client report", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/seasonal-reports",
		headers: { cookie: cityManager.cookie },
		body: {
			seasonal_report_type_id: 1,
			device_id: 1,
			passed: false,
			note: "Needs cleanup",
		},
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<SeasonalReportBody>()).toEqual(
		expect.objectContaining({
			seasonal_report_type_id: 1,
			user_id: cityManager.id,
			device_id: 1,
			passed: false,
			note: "Needs cleanup",
		}),
	);
	createdReportId = res.json<SeasonalReportBody>().id;
});

test("POST /v1/seasonal-reports rejects client writers creating for another client's device", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/seasonal-reports",
		headers: { cookie: cityManager.cookie },
		body: {
			seasonal_report_type_id: 1,
			device_id: 2,
			passed: true,
			note: "Wrong client",
		},
	});

	expect(res.statusCode).toBe(400);
});

test("POST /v1/seasonal-reports lets admins create for another client's device", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/seasonal-reports",
		headers: { cookie: admin.cookie },
		body: {
			seasonal_report_type_id: 1,
			device_id: 1,
			passed: true,
			note: "Admin cross-client report",
		},
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<SeasonalReportBody>()).toEqual(expect.objectContaining({ device_id: 1 }));
});

test("PATCH /v1/seasonal-reports/:id updates a same-client report", async () => {
	const res = await app.inject({
		method: "PATCH",
		url: `/v1/seasonal-reports/${createdReportId}`,
		headers: { cookie: cityManager.cookie },
		body: { passed: true, note: "Cleanup completed" },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<SeasonalReportBody>()).toEqual(
		expect.objectContaining({ id: createdReportId, passed: true, note: "Cleanup completed" }),
	);
});

test("POST /v1/seasonal-reports/:id/answers creates an answer for a report question", async () => {
	const res = await app.inject({
		method: "POST",
		url: `/v1/seasonal-reports/${createdReportId}/answers`,
		headers: { cookie: cityManager.cookie },
		body: { seasonal_report_question_id: 1, response: "yes" },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<SeasonalReportAnswerBody>()).toEqual(
		expect.objectContaining({
			seasonal_report_id: createdReportId,
			seasonal_report_question_id: 1,
			response: "yes",
		}),
	);
});

test("GET /v1/seasonal-reports/:id/answers lists visible report answers", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/seasonal-reports/${createdReportId}/answers`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ data: SeasonalReportAnswerBody[] }>().data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ seasonal_report_question_id: 1, response: "yes" }),
		]),
	);
});

test("POST /v1/seasonal-reports/:id/images creates an image row", async () => {
	const res = await app.inject({
		method: "POST",
		url: `/v1/seasonal-reports/${createdReportId}/images`,
		headers: { cookie: cityManager.cookie },
		body: { description: "Clean solar panel", path: "seasonal-reports/solar-panel.jpg" },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<SeasonalReportImageBody>()).toEqual(
		expect.objectContaining({
			seasonal_report_id: createdReportId,
			description: "Clean solar panel",
			path: "seasonal-reports/solar-panel.jpg",
		}),
	);
});

test("GET /v1/seasonal-reports/:id/images lists image rows", async () => {
	const res = await app.inject({
		method: "GET",
		url: `/v1/seasonal-reports/${createdReportId}/images`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<{ data: SeasonalReportImageBody[] }>().data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ path: "seasonal-reports/solar-panel.jpg" }),
		]),
	);
});

test("DELETE /v1/seasonal-reports/:id returns 409 while answers or images reference it", async () => {
	const res = await app.inject({
		method: "DELETE",
		url: `/v1/seasonal-reports/${createdReportId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(409);
});

test("DELETE /v1/seasonal-reports/:id deletes an unreferenced same-client report", async () => {
	const created = await db.pool.query<{ id: number }>(
		`INSERT INTO seasonal_report (seasonal_report_type_id, date, user_id, device_id, passed, note)
		 VALUES (1, now(), $1, 1, true, 'unreferenced seasonal report')
		 RETURNING id`,
		[cityManager.id],
	);
	const reportId = created.rows[0]!.id;

	const res = await app.inject({
		method: "DELETE",
		url: `/v1/seasonal-reports/${reportId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(204);
	const deleted = await db.pool.query<{ id: number }>(
		`SELECT id FROM seasonal_report WHERE id = $1`,
		[reportId],
	);
	expect(deleted.rows).toEqual([]);
});
