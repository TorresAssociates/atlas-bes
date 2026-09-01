import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type { FastifyRequest } from "fastify";
import { getRequestSession, hasPermission, requirePermission } from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	CreateSeasonalReportAnswerBodySchema,
	CreateSeasonalReportBodySchema,
	CreateSeasonalReportImageBodySchema,
	SeasonalReportAnswerListSchema,
	SeasonalReportAnswerSchema,
	SeasonalReportIdParamsSchema,
	SeasonalReportImageListSchema,
	SeasonalReportImageSchema,
	SeasonalReportListSchema,
	SeasonalReportQuestionCategoryListSchema,
	SeasonalReportQuestionListSchema,
	SeasonalReportSchema,
	SeasonalReportTypeIdParamsSchema,
	SeasonalReportTypeListSchema,
	UpdateSeasonalReportBodySchema,
} from "./schemas";
import {
	type CreateSeasonalReportAnswerInput,
	type CreateSeasonalReportImageInput,
	type CreateSeasonalReportInput,
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
	SeasonalReportDeviceNotFoundError,
	SeasonalReportInUseError,
	SeasonalReportNotFoundError,
	SeasonalReportQuestionMismatchError,
	SeasonalReportQuestionNotFoundError,
	SeasonalReportTypeNotFoundError,
	type UpdateSeasonalReportInput,
	updateSeasonalReport,
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
		if (err instanceof SeasonalReportQuestionNotFoundError)
			return reply.badRequest(err.message);
		if (err instanceof SeasonalReportQuestionMismatchError)
			return reply.badRequest(err.message);
		if (err instanceof SeasonalReportInUseError) return reply.conflict(err.message);
		return reply.send(err);
	});

	async function sessionFor(request: FastifyRequest) {
		const session = await getRequestSession(request);
		if (!session) throw app.httpErrors.unauthorized("authentication required");
		return session;
	}

	// GET /v1/seasonal-reports/types
	app.get(
		"/types",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["seasonal-reports"],
				response: {
					200: SeasonalReportTypeListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async () => ({ data: await listTypes(getDb()) }),
	);

	// GET /v1/seasonal-reports/types/:id/questions
	app.get(
		"/types/:id/questions",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["seasonal-reports"],
				params: SeasonalReportTypeIdParamsSchema,
				response: {
					200: SeasonalReportQuestionListSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const params = request.params;
			return { data: await listTypeQuestions(getDb(), Number(params.id)) };
		},
	);

	// GET /v1/seasonal-reports/question-categories
	app.get(
		"/question-categories",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["seasonal-reports"],
				response: {
					200: SeasonalReportQuestionCategoryListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async () => ({ data: await listQuestionCategories(getDb()) }),
	);

	// GET /v1/seasonal-reports/questions
	app.get(
		"/questions",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["seasonal-reports"],
				response: {
					200: SeasonalReportQuestionListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async () => ({ data: await listQuestions(getDb()) }),
	);

	// GET /v1/seasonal-reports
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["seasonal-reports"],
				response: {
					200: SeasonalReportListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
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
			schema: {
				tags: ["seasonal-reports"],
				body: CreateSeasonalReportBodySchema,
				response: {
					201: SeasonalReportSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
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
			schema: {
				tags: ["seasonal-reports"],
				params: SeasonalReportIdParamsSchema,
				response: {
					200: SeasonalReportAnswerListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params;
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return {
				data: await listAnswers(getDb(), Number(params.id), session, { canReadExternal }),
			};
		},
	);

	// POST /v1/seasonal-reports/:id/answers
	app.post(
		"/:id/answers",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: {
				tags: ["seasonal-reports"],
				params: SeasonalReportIdParamsSchema,
				body: CreateSeasonalReportAnswerBodySchema,
				response: {
					201: SeasonalReportAnswerSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await sessionFor(request);
			const params = request.params;
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
			schema: {
				tags: ["seasonal-reports"],
				params: SeasonalReportIdParamsSchema,
				response: {
					200: SeasonalReportImageListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params;
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return {
				data: await listImages(getDb(), Number(params.id), session, { canReadExternal }),
			};
		},
	);

	// POST /v1/seasonal-reports/:id/images
	app.post(
		"/:id/images",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: {
				tags: ["seasonal-reports"],
				params: SeasonalReportIdParamsSchema,
				body: CreateSeasonalReportImageBodySchema,
				response: {
					201: SeasonalReportImageSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await sessionFor(request);
			const params = request.params;
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
			schema: {
				tags: ["seasonal-reports"],
				params: SeasonalReportIdParamsSchema,
				response: {
					200: SeasonalReportSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params;
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return getSeasonalReport(getDb(), Number(params.id), session, { canReadExternal });
		},
	);

	// PATCH /v1/seasonal-reports/:id
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: {
				tags: ["seasonal-reports"],
				params: SeasonalReportIdParamsSchema,
				body: UpdateSeasonalReportBodySchema,
				response: {
					200: SeasonalReportSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params;
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
			schema: {
				tags: ["seasonal-reports"],
				params: SeasonalReportIdParamsSchema,
				response: {
					204: Type.Null(),
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await sessionFor(request);
			const params = request.params;
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			await deleteSeasonalReport(getDb(), Number(params.id), session, { canWriteExternal });
			return reply.code(204).send(null);
		},
	);
};

export default seasonalReportRoutes;
