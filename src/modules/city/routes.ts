import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
	getRequestSession,
	hasPermission,
	requirePermission,
	requireSession,
} from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	CityIdParamsSchema,
	CityListQuerySchema,
	CityListSchema,
	CitySchema,
	CreateCityBodySchema,
	UpdateCityBodySchema,
} from "./schemas";
import {
	CityAccessDeniedError,
	CityNotFoundError,
	createCity,
	getCity,
	listCities,
	updateCity,
} from "./service";

const cityRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof CityNotFoundError) return reply.notFound(err.message);
		if (err instanceof CityAccessDeniedError) return reply.forbidden(err.message);
		return reply.send(err);
	});

	// GET /v1/city
	app.get(
		"/",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["city"],
				querystring: CityListQuerySchema,
				response: {
					200: CityListSchema,
					401: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canReadClients = await hasPermission(request, "R_CLIENTS");
			return {
				data: await listCities(getDb(), session, { canReadClients }, request.query),
			};
		},
	);

	// GET /v1/city/:id
	app.get(
		"/:id",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["city"],
				params: CityIdParamsSchema,
				response: {
					200: CitySchema,
					401: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canReadClients = await hasPermission(request, "R_CLIENTS");
			return getCity(getDb(), request.params.id, session, { canReadClients });
		},
	);

	// POST /v1/city
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENTS"),
			schema: {
				tags: ["city"],
				body: CreateCityBodySchema,
				response: {
					201: CitySchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const city = await createCity(getDb(), { canWriteClients: true }, request.body);
			return reply.code(201).send(city);
		},
	);

	// PATCH /v1/city/:id
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENTS"),
			schema: {
				tags: ["city"],
				params: CityIdParamsSchema,
				body: UpdateCityBodySchema,
				response: {
					200: CitySchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) =>
			updateCity(getDb(), request.params.id, { canWriteClients: true }, request.body),
	);
};

export default cityRoutes;
