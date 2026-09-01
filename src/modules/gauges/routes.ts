import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
	getRequestSession,
	hasPermission,
	listRequestPermissions,
	requirePermission,
} from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	CreateGaugeBodySchema,
	GaugeFeatureCollectionSchema,
	GaugeIdParamsSchema,
	GaugeListQuerySchema,
	GaugeListSchema,
	GaugeSchema,
	UpdateGaugeBodySchema,
} from "./schemas";
import {
	createGauge,
	GaugeAccessDeniedError,
	GaugeCityNotFoundError,
	GaugeClientNotFoundError,
	GaugeNameConflictError,
	GaugeNotFoundError,
	getGauge,
	listGauges,
	listGaugesGeoJson,
	updateGauge,
} from "./service";

const gaugeRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	// Viewing inactive gauges requires the write permission matching the read
	// scope (W_EXTERNAL_DEVICES for external readers, W_CLIENT_DEVICES otherwise).
	const readAccess = async (request: FastifyRequest) => {
		const permissions = await listRequestPermissions(request);
		const canReadExternal = permissions.includes("R_EXTERNAL_DEVICES");
		const canViewInactive = permissions.includes(
			canReadExternal ? "W_EXTERNAL_DEVICES" : "W_CLIENT_DEVICES",
		);
		return { canReadExternal, canViewInactive };
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof GaugeNotFoundError) return reply.notFound(err.message);
		if (err instanceof GaugeNameConflictError) return reply.conflict(err.message);
		if (err instanceof GaugeAccessDeniedError) return reply.forbidden(err.message);
		if (err instanceof GaugeCityNotFoundError || err instanceof GaugeClientNotFoundError)
			return reply.badRequest(err.message);
		return reply.send(err);
	});

	// GET /v1/gauges
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["gauges"],
				querystring: GaugeListQuerySchema,
				response: {
					200: GaugeListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			return {
				data: await listGauges(getDb(), session, await readAccess(request), request.query),
			};
		},
	);

	// GET /v1/gauges/geojson — the same authorized row set as GET /v1/gauges,
	// projected as a GeoJSON FeatureCollection with each gauge's highest
	// effective device risk level. (The static segment outranks /:id in
	// find-my-way, so there is no routing conflict.)
	app.get(
		"/geojson",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["gauges"],
				querystring: GaugeListQuerySchema,
				response: {
					200: GaugeFeatureCollectionSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			return listGaugesGeoJson(getDb(), session, await readAccess(request), request.query);
		},
	);

	// GET /v1/gauges/:id
	app.get(
		"/:id",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["gauges"],
				params: GaugeIdParamsSchema,
				response: {
					200: GaugeSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			return getGauge(getDb(), request.params.id, session, await readAccess(request));
		},
	);

	// POST /v1/gauges
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["gauges"],
				body: CreateGaugeBodySchema,
				response: {
					201: GaugeSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_DEVICES");
			const gauge = await createGauge(getDb(), session, { canWriteExternal }, request.body);
			return reply.code(201).send(gauge);
		},
	);

	// PATCH /v1/gauges/:id
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["gauges"],
				params: GaugeIdParamsSchema,
				body: UpdateGaugeBodySchema,
				response: {
					200: GaugeSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_DEVICES");
			return updateGauge(
				getDb(),
				request.params.id,
				session,
				{ canWriteExternal },
				request.body,
			);
		},
	);
};

export default gaugeRoutes;
