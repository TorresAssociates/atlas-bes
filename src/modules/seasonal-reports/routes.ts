import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import { hasPermission, requirePermission } from "@/plugins/authorization";
import { getSession } from "../auth/service";
import {
	SeasonalReportDeviceNotFoundError,
	SeasonalReportInUseError,
	SeasonalReportNotFoundError,
	SeasonalReportQuestionMismatchError,
	SeasonalReportQuestionNotFoundError,
	SeasonalReportTypeNotFoundError,
	createAnswer,
	createImage,
	createSeasonalReport,
	deleteSeasonalReport,
	getSeasonalReport,
	listAnswers,
	listImages,
	listQuestionCategories,
	listQuestions,
	listSeasonalReports,
	listTypeQuestions,
	listTypes,
	updateSeasonalReport,
	type CreateSeasonalReportAnswerInput,
	type CreateSeasonalReportImageInput,
	type CreateSeasonalReportInput,
	type UpdateSeasonalReportInput,
} from "./service";

const seasonalReportRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof SeasonalReportNotFoundError) return reply.notFound(err.message);
		if (err instanceof SeasonalReportDeviceNotFoundError) return reply.badRequest(err.message);
		if (err instanceof SeasonalReportTypeNotFoundError) return reply.badRequest(err.message);
		if (err instanceof SeasonalReportQuestionNotFoundError) return reply.badRequest(err.message);
		if (err instanceof SeasonalReportQuestionMismatchError) return reply.badRequest(err.message);
		if (err instanceof SeasonalReportInUseError) return reply.conflict(err.message);
		return reply.send(err);
	});

	async function sessionFor(request: FastifyRequest) {
		const session = await getSession(request);
		if (!session) throw app.httpErrors.unauthorized("authentication required");
		return session;
	}

	// GET /v1/seasonal-reports/types
	app.get(
		"/types",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async () => ({ data: await listTypes(getDb()) }),
	);

	// GET /v1/seasonal-reports/types/:id/questions
	app.get(
		"/types/:id/questions",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async (request) => {
			const params = request.params as { id: number | string };
			return { data: await listTypeQuestions(getDb(), Number(params.id)) };
		},
	);

	// GET /v1/seasonal-reports/question-categories
	app.get(
		"/question-categories",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async () => ({ data: await listQuestionCategories(getDb()) }),
	);

	// GET /v1/seasonal-reports/questions
	app.get(
		"/questions",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async () => ({ data: await listQuestions(getDb()) }),
	);

	// GET /v1/seasonal-reports
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async (request) => {
			const session = await sessionFor(request);
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return { data: await listSeasonalReports(getDb(), session, { canReadExternal }) };
		},
	);

	// POST /v1/seasonal-reports
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async (request, reply) => {
			const session = await sessionFor(request);
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			const report = await createSeasonalReport(
				getDb(),
				session,
				{ canWriteExternal },
				request.body as CreateSeasonalReportInput,
			);
			return reply.code(201).send(report);
		},
	);

	// GET /v1/seasonal-reports/:id/answers
	app.get(
		"/:id/answers",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params as { id: number | string };
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return { data: await listAnswers(getDb(), Number(params.id), session, { canReadExternal }) };
		},
	);

	// POST /v1/seasonal-reports/:id/answers
	app.post(
		"/:id/answers",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async (request, reply) => {
			const session = await sessionFor(request);
			const params = request.params as { id: number | string };
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			const answer = await createAnswer(
				getDb(),
				Number(params.id),
				session,
				{ canWriteExternal },
				request.body as CreateSeasonalReportAnswerInput,
			);
			return reply.code(201).send(answer);
		},
	);

	// GET /v1/seasonal-reports/:id/images
	app.get(
		"/:id/images",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params as { id: number | string };
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return { data: await listImages(getDb(), Number(params.id), session, { canReadExternal }) };
		},
	);

	// POST /v1/seasonal-reports/:id/images
	app.post(
		"/:id/images",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async (request, reply) => {
			const session = await sessionFor(request);
			const params = request.params as { id: number | string };
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			const image = await createImage(
				getDb(),
				Number(params.id),
				session,
				{ canWriteExternal },
				request.body as CreateSeasonalReportImageInput,
			);
			return reply.code(201).send(image);
		},
	);

	// GET /v1/seasonal-reports/:id
	app.get(
		"/:id",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params as { id: number | string };
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return getSeasonalReport(getDb(), Number(params.id), session, { canReadExternal });
		},
	);

	// PATCH /v1/seasonal-reports/:id
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params as { id: number | string };
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			return updateSeasonalReport(
				getDb(),
				Number(params.id),
				session,
				{ canWriteExternal },
				request.body as UpdateSeasonalReportInput,
			);
		},
	);

	// DELETE /v1/seasonal-reports/:id
	app.delete(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: { tags: ["seasonal-reports"] },
		},
		async (request, reply) => {
			const session = await sessionFor(request);
			const params = request.params as { id: number | string };
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			await deleteSeasonalReport(getDb(), Number(params.id), session, { canWriteExternal });
			return reply.code(204).send(null);
		},
	);
};

export default seasonalReportRoutes;
